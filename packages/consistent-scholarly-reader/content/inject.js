// Entry point: listens for the toolbar-click message from background.js and
// idempotently builds/tears down the reading-mode overlay.
(function () {
  "use strict";
  const CSR = window.CSR;
  const api = typeof browser !== "undefined" ? browser : chrome;

  function showToast(message) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText =
      "position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);" +
      "z-index:2147483647;background:#16252C;color:#F2F5F3;" +
      "font:500 .85rem system-ui,sans-serif;padding:.55rem 1rem;border-radius:8px;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.25);max-width:80vw;text-align:center;";
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // Some sites (notably IEEE Xplore) hydrate the article body asynchronously
  // after document_idle; give it a short window to appear before giving up.
  function waitForContent(timeoutMs) {
    return new Promise((resolve) => {
      const immediate = CSR.findParsedArticle(document);
      if (immediate) return resolve(immediate);
      const observer = new MutationObserver(() => {
        const article = CSR.findParsedArticle(document);
        if (article) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(article);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(CSR.findParsedArticle(document));
      }, timeoutMs);
    });
  }

  async function toggle() {
    if (document.getElementById("csr-overlay-host")) {
      CSR.teardownOverlay();
      return;
    }
    if (!CSR.anyParserDetects(document)) {
      showToast("Consistent Scholarly Reader: this page isn't a supported article site.");
      return;
    }
    const article = await waitForContent(2500);
    if (!article) {
      showToast("Couldn't find article text on this page (it may be abstract-only or still loading).");
      return;
    }
    CSR.renderOverlay(article);
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "csr-toggle-reading-mode") toggle();
  });
})();
