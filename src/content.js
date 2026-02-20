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

  /**
   * Unique nonce for this bridge instance.  MAIN-world modules only
   * trust replies and death notices that carry the nonce they received
   * in the most recent "arivozhi-bridge-ready" event.  This prevents
   * stale ISOLATED-world listeners (left over after an extension
   * reload) from poisoning new MAIN-world scripts.
   */
  const BRIDGE_NONCE = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  /** Send a message back to the MAIN world. */
  function reply(id, payload) {
    window.dispatchEvent(
      new CustomEvent(EVENTS.FROM_BRIDGE, {
        detail: { id, nonce: BRIDGE_NONCE, ...payload },
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

  /* ───────── context validity ───────── */

  /**
   * Returns false when the extension has been reloaded, updated, or
   * disabled — i.e. chrome.* APIs are dead.
   */
  function isContextAlive() {
    return !!chrome.runtime?.id;
  }

  /** One-shot: tell MAIN world the bridge is dead, then detach. */
  function notifyBridgeDead() {
    window.removeEventListener(EVENTS.TO_BRIDGE, onBridgeMessage);
    window.dispatchEvent(
      new CustomEvent("arivozhi-bridge-dead", {
        detail: { nonce: BRIDGE_NONCE },
      })
    );
    console.warn("[Arivozhi] Bridge context invalidated — detached listener.");
  }

  /* ───────── listener ───────── */

  function onBridgeMessage(e) {
    if (!isContextAlive()) {
      notifyBridgeDead();
      return;
    }

    const detail = e.detail;
    if (!detail || !detail.action) return;

    const handler = handlers[detail.action];
    if (handler) {
      handler(detail).catch((err) => {
        // The error itself might be context invalidation
        if (!isContextAlive()) {
          notifyBridgeDead();
          return;
        }
        console.error(`[Arivozhi bridge] Error handling "${detail.action}":`, err);
        if (detail.id) reply(detail.id, { ok: false, error: err.message });
      });
    }
  }

  window.addEventListener(EVENTS.TO_BRIDGE, onBridgeMessage);

  /* ───────── settings live-reload ───────── */

  /**
   * When the user toggles a setting in the popup, chrome.storage.sync
   * fires onChanged.  Forward relevant changes to the MAIN world so
   * inject.js can re-apply them without a page reload.
   */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isContextAlive()) return;
    if (area !== "sync") return;

    const payload = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      payload[key] = newValue;
    }

    window.dispatchEvent(
      new CustomEvent("arivozhi-settings-changed", { detail: payload })
    );
  });

  /* ───────── announce readiness ───────── */

  /**
   * Tell MAIN-world scripts which nonce to trust.  Any previously
   * registered modules (surviving from before an extension reload)
   * can use this to resurrect their bridge connection.
   */
  window.dispatchEvent(
    new CustomEvent("arivozhi-bridge-ready", {
      detail: { nonce: BRIDGE_NONCE },
    })
  );

  console.log("[Arivozhi] Content bridge loaded.");
})();
