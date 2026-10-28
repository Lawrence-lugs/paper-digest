// Tests for issue #9: "right sidebar also previews citations".
//
// These tests define the contract for the not-yet-implemented citation sidebar.
// They are expected to fail (RED) until content/citationSidebar.js lands.
//
// Contract expected from content/citationSidebar.js:
//
//   CSR.citationSidebar.attach(shadowRoot, rootEl, bibliographyMap) -> { panel, list }
//     Creates a <div class="csr-citation-sidebar"> next to .csr-root inside
//     shadowRoot and renders the citation preview list. With no active unit the
//     list is empty.
//   CSR.citationSidebar.setActiveUnit(unit) - render citations inside `unit`
//     (re-renders immediately; pass null to empty the list).
//   CSR.citationSidebar.refresh()      - re-render the currently set active unit
//   CSR.citationSidebar.setBibliography(map)
//   CSR.citationSidebar.detach()
//   Panel items are <button class="csr-citation-item" data-csr-cite-ref="..."> whose
//     textContent is the citation preview text: inline data-csr-cite-text wins, else
//     bibliography[ref].text -- the same rules as citationPeek.citationText.
//   Clicking an item copies its preview text via navigator.clipboard.writeText.
//
// The tests drive the reading mark via CSR.readingMark.activate(i) and tell the
// sidebar about the current unit via setActiveUnit(shadow.querySelectorAll(".sr-unit")[i]),
// since readingMark keeps its active unit/module state private.
//
// Preview text reuse: citationText(target) lives inside citationPeek.js's closure
// and is not exported, so the tests assert the same outcomes (bibliography entry
// text, inline attribute precedence) that citationPeek.citationText would produce.

"use strict";

const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const assert = require("node:assert");

const { createWindow } = require("./helpers/dom-shim.js");

const ROOT = path.join(__dirname, "..");
const {
  window,
  document,
  Element,
  Node,
  Text,
  ShadowRoot,
  Range,
  Event,
  MouseEvent,
} = createWindow();

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, "content", file), "utf8");
}

function loadSource(code) {
  const fn = new Function(
    "window",
    "document",
    "Element",
    "Node",
    "Text",
    "ShadowRoot",
    "Range",
    "getComputedStyle",
    "URL",
    "navigator",
    "innerWidth",
    "innerHeight",
    "getSelection",
    "requestAnimationFrame",
    "setTimeout",
    "clearTimeout",
    "ResizeObserver",
    "MutationObserver",
    code
  );
  fn(
    window,
    document,
    Element,
    Node,
    Text,
    ShadowRoot,
    Range,
    window.getComputedStyle,
    URL,
    window.navigator,
    window.innerWidth,
    window.innerHeight,
    window.getSelection,
    window.requestAnimationFrame,
    window.setTimeout,
    window.clearTimeout,
    window.ResizeObserver,
    window.MutationObserver
  );
}

// Load the CSR sources in dependency order (common.js first, it creates window.CSR).
// First load scholarly-reader (required by readingMark.js and render.js).
loadSource(fs.readFileSync(path.join(ROOT, "scholarly-reader", "dist", "scholarly-reader.classic.js"), "utf8"));
loadSource(readSource("common.js"));
loadSource(readSource("citationPeek.js"));
loadSource(readSource("readingMark.js"));
loadSource(readSource("render.js"));

// citationSidebar.js does not exist yet -- the implementation for issue #9 is
// pending. Its absence is recorded but does not crash the harness: each test
// asserts explicitly on CSR.citationSidebar so failures say "not implemented yet".
let sidebarLoadError = null;
try {
  loadSource(readSource("citationSidebar.js"));
} catch (e) {
  sidebarLoadError = e;
}

const CSR = window.CSR;

const BIBLIOGRAPHY = {
  r1: { id: "r1", text: "Alpha, A. \"The first paper.\" Journal of Testing, 2024." },
  r2: { id: "r2", text: "Beta, B. \"The second paper.\" Journal of Tests, 2025." },
  r3: { id: "r3", text: "Gamma, G. \"Never cited in text.\" Nowhere, 2026." },
};

const clipboardWrites = [];
window.navigator.clipboard.writeText = async (text) => {
  clipboardWrites.push(text);
};

function teardown() {
  try {
    if (CSR.teardownOverlay) CSR.teardownOverlay();
  } catch (_) {}
  try {
    if (CSR.readingMark) CSR.readingMark.detach();
  } catch (_) {}
  try {
    if (CSR.citationSidebar) CSR.citationSidebar.detach();
  } catch (_) {}
  const host = document.getElementById("csr-overlay-host");
  if (host) host.remove();
  for (const id of ["csr-fonts", "csr-fonts-preconnect"]) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
  document.documentElement.style.overflow = "";
  clipboardWrites.length = 0;
}

function buildArticleBody() {
  // Three reading units:
  //   unit 0: "The fox is quick."                -- no citations
  //   unit 1: "Lorem ipsum dolor."  [cite r1]    -- r1 only
  //   unit 2: "See two here."          [cite r2]  -- r2 with inline override text
  const content = document.createElement("div");

  const p0 = document.createElement("p");
  p0.appendChild(document.createTextNode("The fox is quick."));
  content.appendChild(p0);

  const p1 = document.createElement("p");
  p1.appendChild(document.createTextNode("Lorem "));
  const a1 = document.createElement("a");
  a1.setAttribute("data-csr-cite-ref", "r1");
  a1.appendChild(document.createTextNode("ipsum"));
  p1.appendChild(a1);
  p1.appendChild(document.createTextNode(" dolor."));
  content.appendChild(p1);

  const p2 = document.createElement("p");
  p2.appendChild(document.createTextNode("See "));
  const a2 = document.createElement("a");
  a2.setAttribute("data-csr-cite-ref", "r2");
  a2.setAttribute("data-csr-cite-text", "INLINE OVERRIDE");
  a2.appendChild(document.createTextNode("two"));
  p2.appendChild(a2);
  p2.appendChild(document.createTextNode(" here."));
  content.appendChild(p2);

  return content;
}

function buildArticle(overrides = {}) {
  return {
    title: "Citation sidebar test article",
    bibliography: BIBLIOGRAPHY,
    sections: [{ title: null, content: buildArticleBody() }],
    ...overrides,
  };
}

// Render an overlay with the reading mark already built (renderOverlay attaches
// readingMark + citationPeek internally). The mark is NOT active yet.
function openOverlay(bibliography = BIBLIOGRAPHY) {
  teardown();
  const article = buildArticle({ bibliography });
  const overlay = CSR.renderOverlay(article);
  assert.ok(overlay.shadow, "renderOverlay created a shadow root");
  assert.ok(overlay.root, "renderOverlay created .csr-root");
  const units = overlay.shadow.querySelectorAll(".sr-unit");
  assert.equal(
    units.length,
    3,
    "the shim + readingMark built three reading units from the article body"
  );
  return { overlay, shadow: overlay.shadow, root: overlay.root, units, article };
}

function requireSidebar() {
  assert.ok(
    CSR.citationSidebar,
    "CSR.citationSidebar is not implemented yet (content/citationSidebar.js for issue #9; load error: " +
      (sidebarLoadError ? sidebarLoadError.message : "none") + ")"
  );
  return CSR.citationSidebar;
}

function citationListOf(sidebar) {
  return sidebar.list || sidebar.panel.querySelector(".csr-citation-list");
}

function itemRefs(sidebar) {
  const list = citationListOf(sidebar);
  return Array.from(list.querySelectorAll(".csr-citation-item")).map((it) =>
    it.getAttribute("data-csr-cite-ref")
  );
}

function itemTexts(sidebar) {
  const list = citationListOf(sidebar);
  return Array.from(list.querySelectorAll(".csr-citation-item")).map((it) => it.textContent);
}

function assertItems(sidebar, expectedRefs, expectedTexts) {
  assert.equal(itemRefs(sidebar).length, expectedRefs.length, "citation item count");
  assert.deepEqual(itemRefs(sidebar), expectedRefs, "citation item refs");
  if (expectedTexts) assert.deepEqual(itemTexts(sidebar), expectedTexts, "citation item texts");
}

// ---------------------------------------------------------------------------
// (a) Right-sidebar panel created/appended alongside overlay when renderOverlay
//     runs with a bibliography.
// ---------------------------------------------------------------------------
test(
  "(a) citation sidebar panel is created next to the overlay",
  async (t) => {
    const { shadow, root, units } = openOverlay();
    const sidebar = requireSidebar();
    assert.doesNotThrow(() => CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY));
    const created = CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);
    assert.ok(created, "citationSidebar.attach returned a panel descriptor");
    const panel = created.panel || created;
    assert.ok(panel && panel.nodeType === Element.ELEMENT_NODE, "panel element exists");
    assert.ok(
      panel.classList.contains("csr-citation-sidebar"),
      "panel carries class csr-citation-sidebar"
    );
    assert.equal(panel.parentNode, shadow, "panel is appended to the shadow root");
    assert.ok(
      shadow.querySelector(".csr-citation-sidebar") === panel,
      "panel is reachable via shadow.querySelector('.csr-citation-sidebar')"
    );
    const elementChildren = Array.from(shadow.childNodes).filter((n) => n.nodeType === Element.ELEMENT_NODE);
    assert.ok(
      elementChildren.includes(root) && elementChildren.includes(panel),
      "root (.csr-root) and panel are both children of the shadow root"
    );
    assert.ok(units.length === 3, "reading units exist (sanity)");
    CSR.citationSidebar.detach();
    teardown();
  }
);

// ---------------------------------------------------------------------------
// (b) Panel lists citation previews drawn from the bibliography map, reusing
//     citationPeek's citation-text rules (bibliography entry text; inline
//     data-csr-cite-text wins).
// ---------------------------------------------------------------------------
test(
  "(b) panel lists citation previews from the bibliography map",
  async (t) => {
    const { shadow, root, units } = openOverlay();
    requireSidebar();
    const created = CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);

    // readingMark.activate() and its active-unit index are module-private, so
    // the tests address reading units directly through the shared DOM and tell
    // the sidebar which unit is current via setActiveUnit().
    CSR.citationSidebar.setActiveUnit(units[1]);
    assertItems(created, ["r1"], [BIBLIOGRAPHY.r1.text]);

    CSR.citationSidebar.setActiveUnit(units[2]);
    assertItems(created, ["r2"], ["INLINE OVERRIDE"]);

    // refresh() re-renders the currently set active unit.
    CSR.citationSidebar.refresh();
    assertItems(created, ["r2"], ["INLINE OVERRIDE"]);

    CSR.citationSidebar.detach();
    teardown();
  }
);

// ---------------------------------------------------------------------------
// (c) Reading-mark gating: active mark at unit i -> ONLY citations inside
//     units[i], not every citation in the bibliography.
// ---------------------------------------------------------------------------
test(
  "(c) reading-mark gating shows only citations inside the current unit",
  async (t) => {
    const { shadow, root, units } = openOverlay();
    requireSidebar();
    const created = CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);

    // readingMark.activate() and its active-unit index are module-private, so
    // the tests address reading units directly through the shared DOM.
    CSR.citationSidebar.setActiveUnit(units[1]); // unit 1 contains r1 only
    assertItems(created, ["r1"], [BIBLIOGRAPHY.r1.text]);
    assert.ok(
      !itemRefs(created).includes("r2") && !itemRefs(created).includes("r3"),
      "r2 and r3 are not shown while the mark is on unit 1"
    );

    CSR.citationSidebar.setActiveUnit(units[0]); // unit 0 has no citations
    assertItems(created, [], []);

    CSR.citationSidebar.setActiveUnit(units[2]); // unit 2 contains r2 only
    assertItems(created, ["r2"], ["INLINE OVERRIDE"]);
    assert.ok(
      !itemRefs(created).includes("r1") && !itemRefs(created).includes("r3"),
      "r1 and r3 are not shown while the mark is on unit 2"
    );

    CSR.citationSidebar.detach();
    teardown();
  }
);

// ---------------------------------------------------------------------------
// (d) Panel updates when the mark moves to another unit (different citation set).
// ---------------------------------------------------------------------------
test(
  "(d) panel updates when the reading mark moves to another unit",
  async (t) => {
    const { shadow, root, units } = openOverlay();
    requireSidebar();
    const created = CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);

    CSR.citationSidebar.setActiveUnit(units[1]);
    const first = itemRefs(created);
    assert.deepEqual(first, ["r1"]);

    CSR.citationSidebar.setActiveUnit(units[2]);
    const second = itemRefs(created);
    assert.deepEqual(second, ["r2"]);
    assert.notDeepEqual(first, second, "the citation set changed when the mark moved");

    CSR.citationSidebar.setActiveUnit(units[0]);
    assert.deepEqual(itemRefs(created), [], "moving to a unit without citations empties the panel");

    CSR.citationSidebar.detach();
    teardown();
  }
);

// ---------------------------------------------------------------------------
// (e) No reading mark / no bibliography -> panel empty or absent, no crash.
// ---------------------------------------------------------------------------
test(
  "(e) no reading mark and no bibliography -> empty panel, no crash",
  async (t) => {
    // No bibliography at all.
    teardown();
    const noBib = buildArticle({ bibliography: undefined });
    const overlay = CSR.renderOverlay(noBib);
    assert.equal(
      noBib.sections[0].content.querySelectorAll("p").length,
      3,
      "the three content paragraphs still build without a bibliography"
    );
    assert.equal(
      overlay.shadow.querySelectorAll(".sr-unit").length,
      3,
      "reading units still build without a bibliography"
    );
    const sidebar = requireSidebar();
    assert.doesNotThrow(() => CSR.citationSidebar.attach(overlay.shadow, overlay.root));
    assert.doesNotThrow(() => CSR.citationSidebar.attach(overlay.shadow, overlay.root, undefined));
    const created = CSR.citationSidebar.attach(overlay.shadow, overlay.root, null);
    assert.equal(citationListOf(created).querySelectorAll(".csr-citation-item").length, 0, "no bibliography -> empty list");
    CSR.citationSidebar.detach();
    teardown();

    // No reading mark active: sidebar lists nothing (panel present but empty).
    const { shadow, root, units } = openOverlay();
    const s2 = CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);
    CSR.citationSidebar.refresh();
    assert.equal(s2.list.querySelectorAll(".csr-citation-item").length, 0, "no active unit -> empty list");
    CSR.citationSidebar.setActiveUnit(units[1]);
    assert.equal(s2.list.querySelectorAll(".csr-citation-item").length, 1, "active unit lists its citations");
    CSR.citationSidebar.setActiveUnit(null);
    assert.equal(s2.list.querySelectorAll(".csr-citation-item").length, 0, "null active unit -> empty list");
    CSR.citationSidebar.detach();
    teardown();
  }
);

// ---------------------------------------------------------------------------
// (f) Clicking a preview copies its text (reuse copyFor path, stubbed clipboard).
// ---------------------------------------------------------------------------
test(
  "(f) clicking a preview copies its text to the clipboard",
  async (t) => {
    const { shadow, root, units } = openOverlay();
    const sidebar = requireSidebar();
    CSR.citationSidebar.attach(shadow, root, BIBLIOGRAPHY);

    CSR.citationSidebar.setActiveUnit(units[1]);
    const item = shadow.querySelector('[data-csr-cite-ref="r1"].csr-citation-item');
    assert.ok(item, "preview item for r1 exists");
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve(); // flush the async clipboard write
    assert.equal(clipboardWrites[0], BIBLIOGRAPHY.r1.text, "copied the preview text of r1");

    // A different unit copies a different text (inline override in this case).
    clipboardWrites.length = 0;
    CSR.citationSidebar.setActiveUnit(units[2]);
    const item2 = shadow.querySelector('[data-csr-cite-ref="r2"].csr-citation-item');
    assert.ok(item2, "preview item for r2 exists");
    item2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    assert.equal(clipboardWrites[0], "INLINE OVERRIDE", "copied the inline override text of r2");

    CSR.citationSidebar.detach();
    teardown();
  }
);
