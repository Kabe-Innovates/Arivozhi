/**
 * Arivozhi — Inject / Orchestrator (MAIN world)
 *
 * This is the entry point that runs in the page's main JS world.
 * It discovers Ace Editor instances, enables autocomplete, attaches
 * the symbol extractor, and registers the cross-question completer.
 *
 * Flow:
 *   1.  Wait for Ace editors to appear (MutationObserver).
 *   2.  For each editor: enable language_tools, attach change listener,
 *       register the Arivozhi custom completer.
 *   3.  On code changes (debounced): extract symbols → save via bridge.
 *   4.  On page unload: final extraction pass.
 */

(() => {
  "use strict";

  const { memory, extractor, completer } = window.Arivozhi;

  /* ─── Configuration ─── */

  const EXTRACT_DEBOUNCE_MS = 800;
  const EDITOR_READY_RETRY_MS = 150;
  const EDITOR_READY_MAX_RETRIES = 25;

  /* ─── State ─── */

  /** Editors we've already hooked — prevents double-attach. */
  const hookedEditors = new WeakSet();

  /** Map of editor element → { questionId, debounceTimer } */
  const editorState = new Map();

  /** The quiz attempt key — derived from the URL. */
  const attemptKey = deriveAttemptKey();

  /** Count of hooked editors — for badge updates. */
  let hookedCount = 0;

  /* ─── Attempt key derivation ─── */

  /**
   * Build a storage key that uniquely identifies the current quiz attempt.
   * Moodle URLs typically look like:
   *   /mod/quiz/attempt.php?attempt=12345&cmid=6789
   * We use "attempt" param if present, otherwise fall back to the full path.
   */
  function deriveAttemptKey() {
    const params = new URLSearchParams(window.location.search);
    const attempt = params.get("attempt");
    if (attempt) return `attempt-${attempt}`;
    // Fallback: use pathname (covers /mod/quiz/view.php etc.)
    return `path-${window.location.pathname}`;
  }

  /* ─── Question ID extraction ─── */

  /**
   * Walk up the DOM from an Ace editor element to find the enclosing
   * Moodle question container and derive a human-readable question ID.
   *
   * Moodle typically wraps each question in:
   *   <div id="question-<attemptid>-<slot>" class="que ...">
   *
   * We return "Q<slot>" (e.g. "Q1", "Q2") so completions read nicely.
   */
  function getQuestionId(editorEl) {
    let el = editorEl;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains("que")) {
        // id is like "question-123-4" where 4 is the slot number
        const match = el.id?.match(/question-\d+-(\d+)/);
        if (match) return `Q${match[1]}`;
        // Fallback: use the question number from the info block
        const info = el.querySelector(".info .no");
        if (info) return `Q${info.textContent.trim()}`;
      }
      el = el.parentElement;
    }
    // Last resort: positional index on the page
    const allEditors = document.querySelectorAll(".ace_editor");
    const index = Array.from(allEditors).indexOf(editorEl);
    return `Q${index + 1}`;
  }

  /* ─── Editor hooking ─── */

  /**
   * Hook a single Ace editor: enable autocomplete, attach listeners,
   * register the cross-question completer.
   */
  async function hookEditor(editorEl) {
    if (hookedEditors.has(editorEl)) return;
    hookedEditors.add(editorEl);

    const editor = editorEl.env.editor;
    const questionId = getQuestionId(editorEl);

    // Fetch user settings
    let settings = {};
    try {
      settings = await memory.getSettings();
    } catch {
      // Use defaults if bridge isn't ready yet
    }

    const liveAutocomplete = settings.liveAutocomplete !== false;
    const minPrefixLength = settings.minPrefixLength ?? 2;
    const crossMemory = settings.crossQuestionMemory !== false;

    // 1. Enable Ace's language_tools if not already active
    if (typeof ace !== "undefined" && ace.require) {
      try {
        ace.require("ace/ext/language_tools");
      } catch { /* already loaded or not available */ }
    }

    editor.setOptions({
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: liveAutocomplete,
      enableSnippets: false,
    });

    // 2. Register cross-question completer
    if (crossMemory) {
      const arivozhiCompleter = completer.create(attemptKey, questionId, {
        minPrefixLength,
      });

      // Avoid duplicate registration
      editor.completers = editor.completers || [];
      if (!editor.completers.some((c) => c.id === arivozhiCompleter.id)) {
        editor.completers.push(arivozhiCompleter);
      }
    }

    // 3. Attach debounced extraction on code changes
    let debounceTimer = null;
    editorState.set(editorEl, { questionId, debounceTimer });

    editor.session.on("change", () => {
      if (!crossMemory) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const symbols = extractor.extract(editor);
        memory.save(attemptKey, questionId, symbols).catch(() => {});
      }, EXTRACT_DEBOUNCE_MS);
      editorState.get(editorEl).debounceTimer = debounceTimer;
    });

    // 4. Do an initial extraction (editor may already have code)
    if (crossMemory) {
      const symbols = extractor.extract(editor);
      if (symbols.length) {
        memory.save(attemptKey, questionId, symbols).catch(() => {});
      }
    }

    hookedCount++;
    memory.updateBadge(hookedCount);

    console.log(
      `[Arivozhi] Hooked editor for ${questionId}` +
        ` (live=${liveAutocomplete}, memory=${crossMemory})`
    );
  }

  /* ─── Editor discovery ─── */

  /**
   * Try to hook an editor element. If the Ace instance isn't ready yet
   * (el.env.editor is undefined), retry with exponential backoff.
   */
  function tryHookEditor(editorEl, retries = EDITOR_READY_MAX_RETRIES) {
    if (editorEl.env?.editor) {
      hookEditor(editorEl);
      return;
    }
    if (retries > 0) {
      setTimeout(() => tryHookEditor(editorEl, retries - 1), EDITOR_READY_RETRY_MS);
    }
  }

  /** Scan the page for any existing Ace editors. */
  function scanForEditors() {
    document.querySelectorAll(".ace_editor").forEach((el) => {
      tryHookEditor(el);
    });
  }

  /**
   * Watch for dynamically added Ace editors (Moodle often lazy-loads them).
   */
  function observeNewEditors() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // The added node itself could be an editor
          if (node.classList?.contains("ace_editor")) {
            tryHookEditor(node);
            continue;
          }

          // Or it could contain editors deeper in its subtree
          const nested = node.querySelectorAll?.(".ace_editor");
          if (nested) nested.forEach((el) => tryHookEditor(el));
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ─── Final extraction on page unload ─── */

  window.addEventListener("beforeunload", () => {
    document.querySelectorAll(".ace_editor").forEach((el) => {
      if (!el.env?.editor) return;
      const state = editorState.get(el);
      if (!state) return;

      const symbols = extractor.extract(el.env.editor);
      // navigator.sendBeacon isn't useful here (we write to extension storage).
      // The bridge CustomEvent is synchronous dispatch, so storage.session.set
      // will be called before the page tears down in most cases.
      try {
        memory.save(attemptKey, state.questionId, symbols);
      } catch { /* best effort */ }
    });
  });

  /* ─── Bootstrap ─── */

  function init() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", init);
      return;
    }
    scanForEditors();
    observeNewEditors();
    console.log(`[Arivozhi] Orchestrator initialized (attempt: ${attemptKey}).`);
  }

  init();
})();
