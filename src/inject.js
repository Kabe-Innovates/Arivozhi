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

  // Guard against duplicate injection after extension reload.
  // MAIN-world scripts persist across reloads — running the IIFE
  // again would create duplicate MutationObservers, event listeners,
  // and state.  The existing orchestrator instance is resurrected
  // via the "arivozhi-bridge-ready" event handled by memory.js.
  if (window.__arivozhiInjected) return;
  window.__arivozhiInjected = true;

  const { memory, extractor, completer } = window.Arivozhi;

  /* ─── Configuration ─── */

  const EXTRACT_DEBOUNCE_MS = 800;
  const EDITOR_READY_RETRY_MS = 150;
  const EDITOR_READY_MAX_RETRIES = 25;

  /* ─── State ─── */

  /** Editors we've already hooked — prevents double-attach. */
  const hookedEditors = new WeakSet();

  /** WeakMap of editor element → { questionId, debounceTimer, editor, crossMemory } */
  const editorState = new WeakMap();

  /** Track all editor elements for iteration (WeakMap isn't iterable). */
  const allEditorEls = new Set();

  /** The quiz attempt key — derived from the URL. */
  const attemptKey = deriveAttemptKey();

  /** Count of hooked editors — for badge updates. */
  let hookedCount = 0;

  function decodeDetail(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        console.warn("[Arivozhi] Ignoring malformed bridge payload.");
        return null;
      }
    }
    if (typeof raw === "object") return raw;
    return null;
  }

  /* ─── Helpers ─── */

  /**
   * Extract symbols from an editor and save them via the bridge.
   * Centralises the extract→save pattern used in multiple places.
   * @param {Element} editorEl — the .ace_editor DOM element
   * @returns {Promise<void>|undefined}
   */
  function extractAndSave(editorEl) {
    if (!editorEl.env?.editor) return;
    const state = editorState.get(editorEl);
    if (!state) return;
    try {
      const symbols = extractor.extract(state.editor);
      if (symbols.length) {
        return memory.save(attemptKey, state.questionId, symbols).catch(() => {});
      }
    } catch { /* best effort */ }
  }

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
    const crossMemory = settings.crossQuestionMemory !== false;

    // 1. Enable Ace's language_tools if not already active
    if (typeof ace !== "undefined" && ace.require) {
      try {
        ace.require("ace/ext/language_tools");
      } catch { /* already loaded or not available */ }
    }

    editor.setOptions({
      enableBasicAutocompletion: true,
      // Pass the prefix length as a number — Ace uses it as the
      // minimum character threshold before auto-opening the dropdown.
      enableLiveAutocompletion: liveAutocomplete,
      enableSnippets: true,
    });

    // 2. Register cross-question completer
    if (crossMemory) {
      const arivozhiCompleter = completer.create(attemptKey, questionId);

      // Avoid duplicate registration
      editor.completers = editor.completers || [];
      if (!editor.completers.some((c) => c.id === arivozhiCompleter.id)) {
        editor.completers.push(arivozhiCompleter);
      }
    }

    // 3. Attach debounced extraction on code changes
    let debounceTimer = null;
    editorState.set(editorEl, { questionId, debounceTimer, editor, crossMemory });
    allEditorEls.add(editorEl);

    editor.session.on("change", () => {
      const st = editorState.get(editorEl);
      if (!st?.crossMemory) return;
      clearTimeout(st.debounceTimer);
      st.debounceTimer = setTimeout(() => {
        extractAndSave(editorEl);
      }, EXTRACT_DEBOUNCE_MS);
    });

    // 4. Do an initial extraction (editor may already have code)
    if (crossMemory) {
      extractAndSave(editorEl);
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
   * (el.env.editor is undefined), retry with a fixed-interval poll.
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

  // Use both pagehide (more reliable) and beforeunload (wider compat)
  // to do a last-chance symbol save before navigation.
  function finalSave() {
    for (const el of allEditorEls) {
      // extractAndSave is synchronous at the CustomEvent dispatch level —
      // the bridge's chrome.storage.session.set() call will be queued
      // before teardown.
      extractAndSave(el);
    }
  }

  window.addEventListener("pagehide", finalSave);
  window.addEventListener("beforeunload", finalSave);

  /* ─── Settings live-reload ─── */

  /**
   * Listen for settings changes broadcast from the content bridge.
   * Re-applies editor options without requiring a page reload.
   */
  window.addEventListener("arivozhi-settings-changed", (e) => {
    const changes = decodeDetail(e.detail) || {};
    for (const el of allEditorEls) {
      const state = editorState.get(el);
      if (!state?.editor) continue;
      const editor = state.editor;

      if ("liveAutocomplete" in changes) {
        editor.setOption("enableLiveAutocompletion", changes.liveAutocomplete);
      }

      if ("crossQuestionMemory" in changes) {
        const enabled = changes.crossQuestionMemory;
        state.crossMemory = enabled;

        if (enabled) {
          // Re-attach cross-question completer
          const arivozhiCompleter = completer.create(attemptKey, state.questionId);
          editor.completers = editor.completers || [];
          if (!editor.completers.some((c) => c.id === arivozhiCompleter.id)) {
            editor.completers.push(arivozhiCompleter);
          }
          // Run immediate extraction for this editor
          extractAndSave(el);
        } else {
          // Remove cross-question completer
          if (editor.completers) {
            editor.completers = editor.completers.filter(
              (c) => c.id !== "arivozhi-cross-question"
            );
          }
          // Cancel any pending extraction
          if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
          }
        }
      }
    }
    console.log("[Arivozhi] Settings reloaded live.", changes);
  });

  /* ─── Bridge-dead cleanup ─── */

  /**
   * Only react to bridge-dead events from the bridge we trust.
   * memory.js tracks the nonce from "arivozhi-bridge-ready";
   * we read it via the same event so we can filter stale deaths.
   */
  let _trustedNonce = null;

  window.addEventListener("arivozhi-bridge-ready", (e) => {
    const detail = decodeDetail(e.detail);
    _trustedNonce = detail?.nonce ?? null;

    // After an extension reload, chrome.storage.session is wiped.
    // Re-extract symbols from every hooked editor so the bridge's
    // fresh storage is repopulated without requiring user interaction.
    // Small delay ensures memory.js processes its own bridge-ready
    // handler first (clears _bridgeDead, updates nonce).
    setTimeout(() => {
      for (const el of allEditorEls) {
        const state = editorState.get(el);
        if (!state?.crossMemory) continue;
        try {
          extractAndSave(el);
        } catch { /* best effort */ }
      }
      // Re-send badge count — the new service worker has no state.
      memory.updateBadge(hookedCount);
      console.log("[Arivozhi] Bridge resurrected — re-extracted symbols for all editors.");
    }, 100);
  });

  window.addEventListener("arivozhi-bridge-dead", (e) => {
    const detail = decodeDetail(e.detail);
    if (detail?.nonce !== _trustedNonce) return; // stale bridge — ignore
    for (const el of allEditorEls) {
      const state = editorState.get(el);
      if (state?.debounceTimer) clearTimeout(state.debounceTimer);
    }
    console.warn("[Arivozhi] Bridge dead — extraction paused until page reload.");
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
