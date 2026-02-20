/**
 * Arivozhi — Popup Script
 *
 * Controls the extension popup:
 *   • Shows active/inactive status based on the current tab's URL.
 *   • Reads and writes user settings to chrome.storage.sync.
 *   • Provides a "Clear Memory" button that wipes chrome.storage.session.
 */

(() => {
  "use strict";

  /* ─── DOM refs ─── */

  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");
  const statusDetail = document.getElementById("statusDetail");
  const settingLive = document.getElementById("settingLive");
  const settingMemory = document.getElementById("settingMemory");
  const settingPrefix = document.getElementById("settingPrefix");
  const btnClear = document.getElementById("btnClear");

  /* ─── Status detection ─── */

  /**
   * Check if the current tab is a Moodle quiz page.
   */
  async function updateStatus() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const url = tab?.url || "";
      const isMoodle =
        url.includes("/mod/quiz/") || url.includes("/question/");

      statusDot.classList.toggle("active", isMoodle);
      statusDot.classList.toggle("inactive", !isMoodle);
      statusLabel.textContent = isMoodle ? "Active" : "Inactive";
      statusDetail.textContent = isMoodle
        ? "Ace editors on this page are enhanced."
        : "Navigate to a Moodle quiz to activate.";
    } catch {
      statusLabel.textContent = "Unknown";
      statusDetail.textContent = "";
    }
  }

  /* ─── Settings ─── */

  async function loadSettings() {
    const settings = await chrome.storage.sync.get({
      liveAutocomplete: true,
      crossQuestionMemory: true,
      minPrefixLength: 2,
    });

    settingLive.checked = settings.liveAutocomplete;
    settingMemory.checked = settings.crossQuestionMemory;
    settingPrefix.value = String(settings.minPrefixLength);
  }

  function saveSetting(key, value) {
    chrome.storage.sync.set({ [key]: value });
  }

  settingLive.addEventListener("change", () => {
    saveSetting("liveAutocomplete", settingLive.checked);
  });

  settingMemory.addEventListener("change", () => {
    saveSetting("crossQuestionMemory", settingMemory.checked);
  });

  settingPrefix.addEventListener("change", () => {
    saveSetting("minPrefixLength", Number(settingPrefix.value));
  });

  /* ─── Clear memory ─── */

  btnClear.addEventListener("click", async () => {
    // Wipe all session storage keys that start with "symbols:"
    const all = await chrome.storage.session.get(null);
    const keysToRemove = Object.keys(all).filter((k) =>
      k.startsWith("symbols:")
    );
    if (keysToRemove.length) {
      await chrome.storage.session.remove(keysToRemove);
    }
    btnClear.textContent = "Cleared ✓";
    btnClear.disabled = true;
    setTimeout(() => {
      btnClear.textContent = "Clear Memory";
      btnClear.disabled = false;
    }, 1500);
  });

  /* ─── Init ─── */

  updateStatus();
  loadSettings();
})();
