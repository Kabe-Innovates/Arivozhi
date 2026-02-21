/**
 * Arivozhi — Popup Script (Minimal)
 */

(() => {
  "use strict";

  /* ─── DOM refs ─── */

  const statusDot    = document.getElementById("statusDot");
  const settingLive  = document.getElementById("settingLive");
  const settingMemory = document.getElementById("settingMemory");
  const btnClear     = document.getElementById("btnClear");

  /* ─── Status detection ─── */

  async function updateStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || "";
      const isMoodle = url.includes("/mod/quiz/") || url.includes("/question/");

      statusDot.classList.toggle("active", isMoodle);
      statusDot.classList.toggle("inactive", !isMoodle);
      statusDot.title = isMoodle ? "Active" : "Inactive";
      statusDot.setAttribute("aria-label", isMoodle ? "Active" : "Inactive");
    } catch {
      statusDot.classList.remove("active");
      statusDot.classList.add("inactive");
      statusDot.title = "Unknown";
      statusDot.setAttribute("aria-label", "Unknown");
    }
  }

  /* ─── Settings ─── */

  async function loadSettings() {
    const s = await chrome.storage.sync.get({
      liveAutocomplete: true,
      crossQuestionMemory: true,
    });
    settingLive.checked  = s.liveAutocomplete;
    settingMemory.checked = s.crossQuestionMemory;
  }

  settingLive.addEventListener("change", () => {
    chrome.storage.sync.set({ liveAutocomplete: settingLive.checked });
  });

  settingMemory.addEventListener("change", () => {
    chrome.storage.sync.set({ crossQuestionMemory: settingMemory.checked });
  });

  /* ─── Clear memory ─── */

  btnClear.addEventListener("click", async () => {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("symbols:"));
    if (keys.length) await chrome.storage.session.remove(keys);

    btnClear.textContent = "Done ✓";
    btnClear.disabled = true;
    setTimeout(() => {
      btnClear.textContent = "Reset";
      btnClear.disabled = false;
    }, 1200);
  });

  /* ─── Init ─── */

  updateStatus();
  loadSettings();
})();
