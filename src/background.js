/**
 * Arivozhi — Background Service Worker
 *
 * Runs once when the extension is installed or updated.
 * Sets default user preferences in chrome.storage.sync and
 * handles delegated session storage operations from content scripts.
 */

const DEFAULTS = {
  liveAutocomplete: true,
  crossQuestionMemory: true,
  showBadge: true,
};

chrome.runtime.onInstalled.addListener(async (details) => {
  // Seed default settings (won't overwrite if user already changed them)
  const current = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) toSet[key] = value;
  }
  if (Object.keys(toSet).length) {
    await chrome.storage.sync.set(toSet);
  }

  // Allow content scripts (ISOLATED world) to access session storage
  if (chrome.storage.session?.setAccessLevel) {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  }
});

async function handleSessionMessage(message) {
  switch (message.type) {
    case "session-get":
      return chrome.storage.session.get(message.keys);
    case "session-set":
      await chrome.storage.session.set(message.data);
      return { success: true };
    case "session-remove":
      await chrome.storage.session.remove(message.keys);
      return { success: true };
    case "session-clear":
      await chrome.storage.session.clear();
      return { success: true };
    default:
      throw new Error(`Unknown session operation: ${message.type}`);
  }
}

/**
 * Listen for badge-update messages from content scripts.
 * message shape: { type: "badge", count: <number>, tabId: <number> }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "badge") {
    if (sender.tab) {
      const text = message.count > 0 ? String(message.count) : "";
      chrome.action.setBadgeText({ text, tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({
        color: "#4CAF50",
        tabId: sender.tab.id,
      });
    }
    return;
  }

  if (message.type && message.type.startsWith("session-")) {
    handleSessionMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error("[Arivozhi background] Session storage error:", err);
        sendResponse({ error: err.message });
      });
    return true;
  }
});
