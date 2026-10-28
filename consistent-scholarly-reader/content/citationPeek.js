// Citation hover peek: hovering (or focusing) an in-text citation link
// shows a small tooltip with the matching bibliography entry's text, pulled
// from the same page -- no network calls or external APIs.
(function () {
  "use strict";
  const CSR = window.CSR;

  let shadow = null;
  let root = null;
  let bibliography = {};
  let tooltip = null;
  let overHandler = null;
  let outHandler = null;
  let moveHandler = null;
  let focusInHandler = null;
  let focusOutHandler = null;
  let clickHandler = null;

  function findRefTarget(node) {
    while (node && node !== shadow) {
      if (node.hasAttribute && (node.hasAttribute("data-csr-cite-ref") || node.hasAttribute("data-csr-cite-text"))) return node;
      node = node.parentNode;
    }
    return null;
  }

  function showFor(target, x, y) {
    const inline = target.getAttribute("data-csr-cite-text");
    const ref = target.getAttribute("data-csr-cite-ref");
    const entry = bibliography[ref];
    const text = inline || (entry ? entry.text : "Reference details not found on this page.");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "csr-peek";
      root.appendChild(tooltip);
    }
    tooltip.textContent = text;
    tooltip.style.display = "block";
    position(tooltip, x, y);
  }

  function position(el, x, y) {
    const pad = 12;
    const rect = el.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > innerWidth - pad) left = innerWidth - rect.width - pad;
    if (top + rect.height > innerHeight - pad) top = y - rect.height - pad;
    el.style.left = Math.max(pad, left) + "px";
    el.style.top = Math.max(pad, top) + "px";
  }

  function hide() {
    if (tooltip) tooltip.style.display = "none";
  }

  function citationText(target) {
    const inline = target.getAttribute("data-csr-cite-text");
    if (inline) return inline;
    const entry = bibliography[target.getAttribute("data-csr-cite-ref")];
    return entry ? entry.text : "";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  let copiedTimer = null;
  async function copyFor(target) {
    const text = citationText(target);
    if (!text) return;
    const ok = await copyText(text);
    if (!tooltip || tooltip.style.display !== "block") return;
    tooltip.textContent = ok ? "Copied to clipboard" : "Copy failed";
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { if (tooltip) tooltip.textContent = text; }, 1200);
  }

  CSR.citationPeek = {
    attach(shadowRoot, bibliographyMap) {
      shadow = shadowRoot;
      root = shadowRoot.getElementById("csr-root");
      bibliography = bibliographyMap || {};

      overHandler = (e) => {
        const target = findRefTarget(e.composedPath ? e.composedPath()[0] : e.target);
        if (target) showFor(target, e.clientX, e.clientY);
      };
      moveHandler = (e) => {
        if (tooltip && tooltip.style.display === "block") position(tooltip, e.clientX, e.clientY);
      };
      outHandler = (e) => {
        const target = findRefTarget(e.composedPath ? e.composedPath()[0] : e.target);
        if (target) hide();
      };
      focusInHandler = (e) => {
        const target = findRefTarget(e.composedPath ? e.composedPath()[0] : e.target);
        if (!target) return;
        const r = target.getBoundingClientRect();
        showFor(target, r.left, r.bottom);
      };
      focusOutHandler = () => hide();
      clickHandler = (e) => {
        const target = findRefTarget(e.composedPath ? e.composedPath()[0] : e.target);
        if (target) copyFor(target);
      };

      shadow.addEventListener("click", clickHandler);
      shadow.addEventListener("mouseover", overHandler);
      shadow.addEventListener("mousemove", moveHandler);
      shadow.addEventListener("mouseout", outHandler);
      shadow.addEventListener("focusin", focusInHandler);
      shadow.addEventListener("focusout", focusOutHandler);
    },
    detach() {
      if (shadow) {
        shadow.removeEventListener("click", clickHandler);
        shadow.removeEventListener("mouseover", overHandler);
        shadow.removeEventListener("mousemove", moveHandler);
        shadow.removeEventListener("mouseout", outHandler);
        shadow.removeEventListener("focusin", focusInHandler);
        shadow.removeEventListener("focusout", focusOutHandler);
      }
      tooltip = null;
      shadow = null;
      root = null;
      bibliography = {};
    },
  };
})();
