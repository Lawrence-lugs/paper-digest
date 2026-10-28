// Background service worker: toolbar icon click toggles reading mode in the active tab.
// Uses a cross-browser `api` alias so the same code works under Chrome and Firefox MV3.
const api = typeof browser !== "undefined" ? browser : chrome;

api.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== "number") return;
  try {
    await api.tabs.sendMessage(tab.id, { type: "csr-toggle-reading-mode" });
  } catch (err) {
    // No content script on this page (unsupported site) -- nothing to toggle.
    console.debug("Consistent Scholarly Reader: no content script on this tab.", err);
  }
});
