/**
 * Arivozhi — Custom Ace Completer (MAIN world)
 *
 * Registers a completer that surfaces cross-question symbols in the
 * Ace autocomplete dropdown, tagged with their origin question.
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

  /** Score boost so our symbols appear above generic keyword suggestions. */
  const BASE_SCORE = 1000;

  /**
   * Create a completer instance bound to a specific quiz attempt.
   *
   * @param  {string} attemptKey       Unique quiz-attempt identifier.
   * @param  {string} currentQuestionId  The question this editor belongs to.
   * @param  {Object} options
   * @param  {number} options.minPrefixLength  Minimum chars before suggesting (default 2).
   * @return {Object} Ace-compatible completer with getCompletions().
   */
  function create(attemptKey, currentQuestionId, options = {}) {
    const minPrefix = options.minPrefixLength ?? 2;

    /** Cached completions — refreshed on each load. */
    let _completions = [];
    let _lastLoadTime = 0;
    const CACHE_TTL = 2000; // ms — reload from storage at most every 2 s

    async function refreshCompletions() {
      const now = Date.now();
      if (now - _lastLoadTime < CACHE_TTL && _completions.length) return;
      _lastLoadTime = now;

      try {
        const allSymbols = await Arivozhi.memory.load(attemptKey);
        _completions = [];

        for (const [qId, symbols] of Object.entries(allSymbols)) {
          // Don't suggest symbols from the *current* question — Ace's
          // built-in local completer already handles that.
          if (qId === currentQuestionId) continue;

          for (const sym of symbols) {
            _completions.push({
              caption: sym.name,
              value: sym.name,
              score: BASE_SCORE,
              meta: `${TYPE_ICONS[sym.type] || "•"} ↩ ${qId}`,
            });
          }
        }
      } catch (err) {
        console.warn("[Arivozhi completer] Failed to load symbols:", err);
      }
    }

    return {
      // Unique id so Ace doesn't register it twice
      id: "arivozhi-cross-question",

      /**
       * Called by Ace whenever the autocomplete dropdown opens.
       */
      getCompletions(editor, session, pos, prefix, callback) {
        // Respect minimum prefix length
        if (prefix.length < minPrefix) {
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
