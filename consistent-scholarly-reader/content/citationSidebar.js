// Citation sidebar: a right-side panel that previews citations from the
// article's bibliography, gated to the currently reading-marked unit.
// Only citations inside the active reading-mark unit are listed, and the
// panel updates as the mark moves (driven via setActiveUnit/refresh).
// No network calls or external APIs; preview text reuses the same rules as
// citationPeek (inline data-csr-cite-text wins, else the bibliography entry).
//
// Contract:
//   CSR.citationSidebar.attach(shadowRoot, rootEl, bibliographyMap) -> { panel, list }
//     Creates <div class="csr-citation-sidebar"> next to .csr-root inside
//     shadowRoot and renders the citation preview list. Empty when no unit is active.
//   CSR.citationSidebar.setActiveUnit(unit) - render citations inside `unit`
//     (pass null to empty the list); re-renders immediately.
//   CSR.citationSidebar.refresh() - re-render the currently set active unit
//   CSR.citationSidebar.setBibliography(map)
//   CSR.citationSidebar.detach()
//   Panel items are <button class="csr-citation-item" data-csr-cite-ref="...">
//     whose textContent is the citation preview text. Clicking copies the text
//     to the clipboard via navigator.clipboard.writeText.
(function () {
  "use strict";
  const CSR = window.CSR;

  let shadow = null;
  let root = null;
  let panel = null;
  let list = null;
  let bibliography = {};
  let activeUnit = null;

  // Preview text for a citation anchor: inline data-csr-cite-text wins, else
  // the matching bibliography entry's text (same rules as citationPeek).
  function previewText(target) {
    const inline = target.getAttribute("data-csr-cite-text");
    if (inline) return inline;
    const ref = target.getAttribute("data-csr-cite-ref");
    const entry = bibliography[ref];
    return entry ? entry.text : "";
  }

  // Citation anchors inside a reading unit, de-duplicated by ref, earliest first.
  function citationTargetsInUnit(unit) {
    const out = [];
    if (!unit) return out;
    const seen = new Set();
    unit.querySelectorAll("[data-csr-cite-ref]").forEach((a) => {
      const ref = a.getAttribute("data-csr-cite-ref");
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        out.push({ ref, el: a });
      }
    });
    return out;
  }

  function render() {
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const { ref, el } of citationTargetsInUnit(activeUnit)) {
      const text = previewText(el);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "csr-citation-item";
      btn.setAttribute("data-csr-cite-ref", ref);
      btn.textContent = text;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        copyText(text);
      });
      list.appendChild(btn);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Clipboard unavailable in this context; silently fail.
    }
  }

  CSR.citationSidebar = {
    attach(shadowRoot, rootEl, bibliographyMap) {
      this.detach();
      shadow = shadowRoot;
      root = rootEl;
      bibliography = bibliographyMap || {};
      activeUnit = null;
      panel = document.createElement("div");
      panel.className = "csr-citation-sidebar";
      list = document.createElement("div");
      list.className = "csr-citation-list";
      panel.appendChild(list);
      shadow.appendChild(panel);
      render();
      return { panel, list };
    },
    setActiveUnit(unit) {
      activeUnit = unit;
      render();
      return this;
    },
    refresh() {
      render();
      return this;
    },
    setBibliography(map) {
      bibliography = map || {};
      render();
      return this;
    },
    detach() {
      if (panel && panel.parentNode) panel.remove();
      panel = null;
      list = null;
      shadow = null;
      root = null;
      bibliography = {};
      activeUnit = null;
    },
  };
})();
