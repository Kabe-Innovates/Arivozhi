/**
 * Arivozhi — Content Script (ISOLATED world)
 *
 * Bridge between the MAIN-world scripts (inject.js, memory.js, etc.)
 * and the chrome.storage.session / chrome.runtime APIs that are only
 * accessible from the ISOLATED world.
 *
 * Communication protocol:
 *   MAIN  →  ISOLATED : window.dispatchEvent(CustomEvent("arivozhi-to-bridge", { detail }))
 *   ISOLATED →  MAIN  : window.dispatchEvent(CustomEvent("arivozhi-from-bridge", { detail }))
 */

(() => {
  "use strict";

  /* ───────── helpers ───────── */

  const EVENTS = {
    TO_BRIDGE: "arivozhi-to-bridge",
    FROM_BRIDGE: "arivozhi-from-bridge",
  };

  /** Send a message back to the MAIN world. */
  function reply(id, payload) {
    window.dispatchEvent(
      new CustomEvent(EVENTS.FROM_BRIDGE, {
        detail: { id, ...payload },
      })
    );
  }

  /* ───────── message handlers ───────── */

  const handlers = {
    /**
     * Save symbols for a question.
     * detail: { action: "saveSymbols", attemptKey, questionId, symbols }
     */
    async saveSymbols({ id, attemptKey, questionId, symbols }) {
      const storageKey = `symbols:${attemptKey}`;
      const data = (await chrome.storage.session.get(storageKey))[storageKey] || {};
      data[questionId] = symbols;
      await chrome.storage.session.set({ [storageKey]: data });
      reply(id, { ok: true });
    },

    /**
     * Load all symbols for the current quiz attempt.
     * detail: { action: "loadSymbols", attemptKey }
     */
    async loadSymbols({ id, attemptKey }) {
      const storageKey = `symbols:${attemptKey}`;
      const data = (await chrome.storage.session.get(storageKey))[storageKey] || {};
      reply(id, { ok: true, data });
    },

    /**
     * Clear all symbols for the current quiz attempt.
     * detail: { action: "clearSymbols", attemptKey }
     */
    async clearSymbols({ id, attemptKey }) {
      const storageKey = `symbols:${attemptKey}`;
      await chrome.storage.session.remove(storageKey);
      reply(id, { ok: true });
    },

    /**
     * Update the extension badge with the count of hooked editors.
     * detail: { action: "updateBadge", count }
     */
    async updateBadge({ count }) {
      chrome.runtime.sendMessage({ type: "badge", count });
    },

    /**
     * Get user settings from chrome.storage.sync.
     * detail: { action: "getSettings" }
     */
    async getSettings({ id }) {
      const settings = await chrome.storage.sync.get(null);
      reply(id, { ok: true, data: settings });
    },
  };

  /* ───────── listener ───────── */

  window.addEventListener(EVENTS.TO_BRIDGE, async (e) => {
    const detail = e.detail;
    if (!detail || !detail.action) return;

    const handler = handlers[detail.action];
    if (handler) {
      try {
        await handler(detail);
      } catch (err) {
        console.error(`[Arivozhi bridge] Error handling "${detail.action}":`, err);
        if (detail.id) reply(detail.id, { ok: false, error: err.message });
      }
    }
  });

  console.log("[Arivozhi] Content bridge loaded.");
})();
