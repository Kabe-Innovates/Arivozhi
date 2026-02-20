/**
 * Arivozhi — Custom Ace Completer (MAIN world)
 *
 * Registers a completer that surfaces cross-question symbols in the
 * Ace autocomplete dropdown, tagged with their origin question.
 *
 * Phase 5 additions:
 *   • Cross-question deduplication (merged origin tags)
 *   • Snippet completions for functions with signatures
 *   • Type-aware scoring (functions/classes > variables)
 *
 * Usage:
 *   const completer = Arivozhi.completer.create(attemptKey, currentQuestionId);
 *   editor.completers.push(completer);
 */

window.Arivozhi = window.Arivozhi || {};

window.Arivozhi.completer = (() => {
  "use strict";

  /** Map symbol type → icon character for the autocomplete dropdown. */
  const TYPE_ICONS = {
    function: "ƒ",
    class: "◆",
    variable: "𝑥",
  };

  /** Type-aware scoring — functions and classes rank higher than variables. */
  const TYPE_SCORES = {
    function: 1200,
    class: 1100,
    variable: 1000,
  };

  /**
   * Create a completer instance bound to a specific quiz attempt.
   *
   * @param  {string} attemptKey         Unique quiz-attempt identifier.
   * @param  {string} currentQuestionId  The question this editor belongs to.
   * @param  {Object} options
   * @return {Object} Ace-compatible completer with getCompletions().
   */
  function create(attemptKey, currentQuestionId, options = {}) {
    const MIN_PREFIX = 2;

    /** Cached completions — refreshed on each load. */
    let _completions = [];
    let _lastLoadTime = 0;
    let _loadFailed = false;
    const CACHE_TTL = 2000; // ms — reload from storage at most every 2 s

    /**
     * Deduplicate symbols across questions.
     * If the same name appears in Q1 and Q3, merge into one entry
     * with a combined origin tag like "↩ Q1, Q3".
     * Keep the most complete info (signature wins over no signature).
     */
    function deduplicateAndBuild(allSymbols) {
      // Map: name → { type, signature, origins: Set<string> }
      const merged = new Map();

      for (const [qId, symbols] of Object.entries(allSymbols)) {
        if (qId === currentQuestionId) continue;

        for (const sym of symbols) {
          const existing = merged.get(sym.name);
          if (existing) {
            existing.origins.add(qId);
            // Prefer the richer info (signature if available)
            if (sym.signature && !existing.signature) {
              existing.signature = sym.signature;
            }
            // Prefer function/class over variable
            if (sym.type !== "variable" && existing.type === "variable") {
              existing.type = sym.type;
            }
          } else {
            merged.set(sym.name, {
              type: sym.type,
              signature: sym.signature || null,
              origins: new Set([qId]),
            });
          }
        }
      }

      return merged;
    }

    async function refreshCompletions() {
      const now = Date.now();
      if (now - _lastLoadTime < CACHE_TTL && _completions.length) return;
      _lastLoadTime = now;

      try {
        const allSymbols = await Arivozhi.memory.load(attemptKey);
        const merged = deduplicateAndBuild(allSymbols);
        _completions = [];

        for (const [name, info] of merged) {
          const originTag = [...info.origins].sort().join(", ");
          const icon = TYPE_ICONS[info.type] || "•";
          const score = TYPE_SCORES[info.type] || 1000;

          const entry = {
            caption: name,
            score,
            meta: `${icon} ↩ ${originTag}`,
          };

          // If we have a function signature, offer a snippet completion
          // with tab-stop placeholders: calculate(${1:a}, ${2:b})
          if (info.type === "function" && info.signature) {
            const params = info.signature.split(",").map((p) => p.trim());
            const snippetParams = params
              .map((p, i) => `\${${i + 1}:${p}}`)
              .join(", ");
            entry.snippet = `${name}(${snippetParams})`;
            entry.value = `${name}(${info.signature})`; // fallback if snippet fails
            entry.caption = `${name}(${info.signature})`;
          } else {
            entry.value = name;
          }

          _completions.push(entry);
        }
      } catch (err) {
        if (!_loadFailed) {
          console.warn("[Arivozhi completer] Bridge unavailable — using cached completions.");
          _loadFailed = true;
        }
      }
    }

    return {
      // Unique id so Ace doesn't register it twice
      id: "arivozhi-cross-question",

      /**
       * Explicitly handle insertion so snippet tab-stops work
       * regardless of which Ace version Moodle bundles.
       */
      insertMatch(editor, data) {
        // Remove the typed prefix
        const cursor = editor.getCursorPosition();
        const line = editor.session.getLine(cursor.row);
        let col = cursor.column;
        while (col > 0 && /\w/.test(line[col - 1])) col--;
        if (col < cursor.column) {
          editor.session.remove({
            start: { row: cursor.row, column: col },
            end:   { row: cursor.row, column: cursor.column },
          });
        }

        if (data.snippet) {
          try {
            const snippetManager = ace.require("ace/snippets").snippetManager;
            snippetManager.insertSnippet(editor, data.snippet);
          } catch {
            // Fallback to plain text if snippet system unavailable
            editor.execCommand("insertstring", data.value || data.caption || "");
          }
        } else {
          editor.execCommand("insertstring", data.value || data.caption || "");
        }
      },

      /**
       * Called by Ace whenever the autocomplete dropdown opens.
       */
      getCompletions(editor, session, pos, prefix, callback) {
        // Respect minimum prefix length
        if (prefix.length < MIN_PREFIX) {
          return callback(null, []);
        }

        // Refresh cache asynchronously, then filter by prefix
        refreshCompletions().then(() => {
          const lowerPrefix = prefix.toLowerCase();
          const filtered = _completions.filter((c) =>
            c.caption.toLowerCase().startsWith(lowerPrefix)
          );
          callback(null, filtered);
        });
      },
    };
  }

  return { create };
})();
