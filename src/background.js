/**
 * Arivozhi — Background Service Worker
 *
 * Runs once when the extension is installed or updated.
 * Sets default user preferences in chrome.storage.sync and
 * configures chrome.storage.session access for content scripts.
 */

const DEFAULTS = {
  liveAutocomplete: true,
  minPrefixLength: 2,
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
  if (chrome.storage.session.setAccessLevel) {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  }
});

/**
 * Listen for badge-update messages from content scripts.
 * message shape: { type: "badge", count: <number>, tabId: <number> }
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "badge" && sender.tab) {
    const text = message.count > 0 ? String(message.count) : "";
    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({
      color: "#4CAF50",
      tabId: sender.tab.id,
    });
  }
});
