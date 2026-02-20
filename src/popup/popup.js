/**
 * Arivozhi — Popup Script
 *
 * Controls the extension popup:
 *   • Shows active/inactive status based on the current tab's URL.
 *   • Reads and writes user settings to chrome.storage.sync.
 *   • Shows remembered symbols grouped by question.
 *   • Provides a "Clear Memory" button that wipes chrome.storage.session.
 */

(() => {
  "use strict";

  const TYPE_ICONS = { function: "ƒ", class: "◆", variable: "𝑥" };
  const TYPE_CSS   = { function: "fn", class: "cls", variable: "var" };

  /* ─── DOM refs ─── */

  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");
  const statusDetail = document.getElementById("statusDetail");
  const settingLive = document.getElementById("settingLive");
  const settingMemory = document.getElementById("settingMemory");
  const btnClear = document.getElementById("btnClear");
  const symbolsList = document.getElementById("symbolsList");
  const symbolsEmpty = document.getElementById("symbolsEmpty");
  const symbolCount = document.getElementById("symbolCount");

  /* ─── Status detection ─── */

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
    });

    settingLive.checked = settings.liveAutocomplete;
    settingMemory.checked = settings.crossQuestionMemory;
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

  /* ─── Symbol viewer ─── */

  async function loadSymbols() {
    const all = await chrome.storage.session.get(null);
    const symbolKeys = Object.keys(all).filter((k) => k.startsWith("symbols:"));

    // Clear existing content except the empty message
    symbolsList.innerHTML = "";

    let total = 0;

    if (!symbolKeys.length) {
      symbolsList.appendChild(createEmpty());
      symbolCount.textContent = "0";
      return;
    }

    // Sort keys for consistent ordering
    symbolKeys.sort();

    for (const key of symbolKeys) {
      const questionsMap = all[key]; // { Q1: [...], Q2: [...] }
      if (!questionsMap || typeof questionsMap !== "object") continue;

      const questionIds = Object.keys(questionsMap).sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
        return na - nb;
      });

      for (const qId of questionIds) {
        const symbols = questionsMap[qId];
        if (!Array.isArray(symbols) || !symbols.length) continue;

        // Question header
        const qHeader = document.createElement("div");
        qHeader.className = "symbol-question";
        qHeader.textContent = qId;
        symbolsList.appendChild(qHeader);

        for (const sym of symbols) {
          total++;
          const item = document.createElement("div");
          item.className = "symbol-item";

          const icon = document.createElement("span");
          icon.className = `symbol-icon ${TYPE_CSS[sym.type] || ""}`;
          icon.textContent = TYPE_ICONS[sym.type] || "•";

          const name = document.createElement("span");
          name.className = "symbol-name";
          name.textContent = sym.signature
            ? `${sym.name}(${sym.signature})`
            : sym.name;
          name.title = sym.signature
            ? `${sym.name}(${sym.signature}) — ${sym.type}`
            : `${sym.name} — ${sym.type}`;

          item.appendChild(icon);
          item.appendChild(name);
          symbolsList.appendChild(item);
        }
      }
    }

    if (total === 0) {
      symbolsList.appendChild(createEmpty());
    }

    symbolCount.textContent = String(total);
  }

  function createEmpty() {
    const p = document.createElement("p");
    p.className = "symbols-empty";
    p.textContent = "No symbols stored yet.";
    return p;
  }

  /* ─── Clear memory ─── */

  btnClear.addEventListener("click", async () => {
    const all = await chrome.storage.session.get(null);
    const keysToRemove = Object.keys(all).filter((k) =>
      k.startsWith("symbols:")
    );
    if (keysToRemove.length) {
      await chrome.storage.session.remove(keysToRemove);
    }
    btnClear.textContent = "Cleared ✓";
    btnClear.disabled = true;

    // Refresh the symbol viewer
    loadSymbols();

    setTimeout(() => {
      btnClear.textContent = "Clear Memory";
      btnClear.disabled = false;
    }, 1500);
  });

  /* ─── Init ─── */

  updateStatus();
  loadSettings();
  loadSymbols();
})();
