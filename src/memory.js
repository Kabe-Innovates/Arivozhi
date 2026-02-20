/**
 * Arivozhi — Memory Module (MAIN world)
 *
 * Provides an async API for saving / loading cross-question symbols.
 * Under the hood it talks to the ISOLATED-world content.js bridge
 * which persists data in chrome.storage.session.
 *
 * Usage (from other MAIN-world modules):
 *   await Arivozhi.memory.save(attemptKey, questionId, symbols);
 *   const all = await Arivozhi.memory.load(attemptKey);
 *   await Arivozhi.memory.clear(attemptKey);
 */

window.Arivozhi = window.Arivozhi || {};

window.Arivozhi.memory = (() => {
  "use strict";

  const EVENTS = {
    TO_BRIDGE: "arivozhi-to-bridge",
    FROM_BRIDGE: "arivozhi-from-bridge",
  };

  let _msgId = 0;

  /** Set when the bridge fires "arivozhi-bridge-dead" (extension reloaded). */
  let _bridgeDead = false;

  /** Nonce of the current trusted bridge (set by "arivozhi-bridge-ready"). */
  let _bridgeNonce = null;

  /**
   * A new ISOLATED-world bridge has loaded (or re-loaded after an
   * extension update).  Accept its nonce and resurrect if we were
   * previously marked dead.
   */
  window.addEventListener("arivozhi-bridge-ready", (e) => {
    _bridgeNonce = e.detail?.nonce ?? null;
    if (_bridgeDead) {
      _bridgeDead = false;
      console.log("[Arivozhi memory] Bridge resurrected with new nonce.");
    }
  });

  /**
   * Only honour bridge-dead notices from the bridge we currently trust.
   * Stale ISOLATED-world contexts (from a previous extension load) may
   * fire this event with an old nonce — we must ignore those.
   */
  window.addEventListener("arivozhi-bridge-dead", (e) => {
    if (e.detail?.nonce !== _bridgeNonce) return; // stale bridge — ignore
    _bridgeDead = true;
    console.warn("[Arivozhi memory] Bridge is dead — suppressing future requests.");
  });

  /**
   * Send a request to the ISOLATED-world bridge and wait for a response.
   * Returns a Promise that resolves with the bridge's reply payload.
   */
  function request(action, payload = {}, timeoutMs = 3000) {
    if (_bridgeDead) {
      return Promise.reject(new Error("Bridge context invalidated"));
    }
    return new Promise((resolve, reject) => {
      const id = `msg-${++_msgId}`;
      const timer = setTimeout(() => {
        window.removeEventListener(EVENTS.FROM_BRIDGE, onReply);
        reject(new Error(`[Arivozhi memory] Bridge timeout for "${action}"`));
      }, timeoutMs);

      function onReply(e) {
        if (e.detail?.id !== id) return;
        // Ignore replies from a stale bridge (mismatched nonce)
        if (_bridgeNonce && e.detail.nonce !== _bridgeNonce) return;
        clearTimeout(timer);
        window.removeEventListener(EVENTS.FROM_BRIDGE, onReply);
        if (e.detail.ok) {
          resolve(e.detail.data);
        } else {
          reject(new Error(e.detail.error || "Bridge error"));
        }
      }

      window.addEventListener(EVENTS.FROM_BRIDGE, onReply);
      window.dispatchEvent(
        new CustomEvent(EVENTS.TO_BRIDGE, {
          detail: { id, action, ...payload },
        })
      );
    });
  }

  /* ───────── public API ───────── */

  /**
   * Save extracted symbols for a specific question.
   * @param {string} attemptKey  Unique key for the quiz attempt.
   * @param {string} questionId  Identifier for the question (e.g. "q3").
   * @param {Array}  symbols     Array of { name, type, meta? } objects.
   */
  async function save(attemptKey, questionId, symbols) {
    await request("saveSymbols", { attemptKey, questionId, symbols });
  }

  /**
   * Load all saved symbols for the quiz attempt.
   * @param  {string} attemptKey
   * @return {Object} Map of questionId → symbol arrays.
   */
  async function load(attemptKey) {
    return (await request("loadSymbols", { attemptKey })) || {};
  }

  /**
   * Clear all symbols for the quiz attempt.
   * @param {string} attemptKey
   */
  async function clear(attemptKey) {
    await request("clearSymbols", { attemptKey });
  }

  /**
   * Retrieve user settings from chrome.storage.sync via the bridge.
   * @return {Object} Settings map.
   */
  async function getSettings() {
    return (await request("getSettings")) || {};
  }

  /**
   * Ask the bridge to update the extension icon badge.
   * Fire-and-forget (no response expected).
   * @param {number} count  Number of hooked editors.
   */
  function updateBadge(count) {
    if (_bridgeDead) return;
    window.dispatchEvent(
      new CustomEvent(EVENTS.TO_BRIDGE, {
        detail: { action: "updateBadge", count },
      })
    );
  }

  return { save, load, clear, getSettings, updateBadge };
})();
