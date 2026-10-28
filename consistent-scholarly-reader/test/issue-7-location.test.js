"use strict";

// Tests for GitHub issue #7: "consistent location on click".
// Preserve reading-mark/section position when toggling reading mode on/off,
// bidirectionally, mapping between publisher page and reader by section
// heading anchor (id/title), not raw pixels.
//
// These tests exercise the real CSR source files (content/common.js,
// content/render.js, content/readingMark.js, content/citationPeek.js) loaded
// through a minimal DOM shim under plain Node (`node --test`). They assert
// the DESIRED behavior. The feature is not implemented yet, so the
// scroll/restore assertions are expected to fail (RED) until the
// implementation lands.

const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const assert = require("node:assert");

const { makeWindowDocument, MouseEvent } = require("./helpers/dom-shim");

const CONTENT_DIR = path.join(__dirname, "..", "content");

function loadCSR(window, document) {
  // Bare identifiers the IIFE sources resolve against this sandbox scope.
  /* eslint-disable no-unused-vars */
  const {
    innerWidth, innerHeight, getSelection, getComputedStyle, requestAnimationFrame,
    ResizeObserver, MutationObserver, URL,
  } = window;
  /* eslint-enable no-unused-vars */
  // Load scholarly-reader first (required by readingMark.js and render.js)
  eval(fs.readFileSync(path.join(CONTENT_DIR, "..", "scholarly-reader", "dist", "scholarly-reader.classic.js"), "utf8"));
  for (const name of ["common.js", "render.js", "readingMark.js", "citationPeek.js"]) {
    eval(fs.readFileSync(path.join(CONTENT_DIR, name), "utf8"));
  }
  return window.CSR;
}

function fresh() {
  const shim = makeWindowDocument();
  const CSR = loadCSR(shim.window, shim.document);
  shim.window.__csr.scrollByLog.length = 0;
  shim.document.documentElement.scrollTop = 0;
  return { ...shim, CSR };
}

function contentWith(document, sentences) {
  const div = document.createElement("div");
  for (const sentence of sentences) {
    const p = document.createElement("p");
    p.textContent = sentence;
    div.appendChild(p);
  }
  return div;
}

function makeArticle(document, sections) {
  const defaults = [
    { id: "s1", title: "Section One", content: contentWith(document, ["First paragraph text."]) },
    { id: "s2", title: "Section Two", content: contentWith(document, ["Second paragraph text.", "Third paragraph text."]) },
    { id: "s3", title: "Section Three", content: contentWith(document, ["Fourth paragraph text."]) },
  ];
  return {
    title: "Test Article",
    venueLine: "Test Venue",
    authors: "A. Author",
    bibliography: {},
    sections: sections || defaults,
  };
}

// Resolve the section (heading anchor) that contains a reading-mark unit in
// the reader DOM: the nearest preceding h2.sr-h2 sibling ancestor of the block
// holding the unit.
function sectionIdOfUnit(unit, main) {
  let node = unit;
  while (node && node.parentNode !== main) node = node.parentNode;
  if (!node) return null;
  let lastH2 = null;
  for (const child of main.childNodes) {
    if (child === node) break;
    if (child.nodeType === 1 && child.tagName === "H2" && child.classList.contains("sr-h2")) {
      lastH2 = child;
    }
  }
  return lastH2 ? lastH2.id : null;
}

// Activate the reading mark on a given unit, as a user click would.
function activateOnUnit(document, shadow, units, unitIndex) {
  const unit = units[unitIndex];
  assert.ok(unit, `reading-mark unit #${unitIndex} must exist`);
  unit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return unit;
}

test("renderOverlay scrolls to the section containing the active reading mark", () => {
  const { window, document, CSR } = fresh();
  const article = makeArticle(document);

  const { host, shadow, root, scroll } = CSR.renderOverlay(article);
  assert.ok(host && host.id === "csr-overlay-host", "overlay host must be created");
  assert.ok(root.querySelector("main"), "reader page must contain a main element");

  const units = shadow.querySelectorAll(".sr-unit");
  assert.ok(units.length >= 3, "expected reading-mark units to be built from the article");

  // Locate a reading-mark unit that lives in section "s2" (the header paragraphs
  // are units too, so locate by section anchor rather than by array index).
  const main = root.querySelector("main");
  const activeUnit = units.find((u) => sectionIdOfUnit(u, main) === "s2");
  assert.ok(activeUnit, "fixture: a unit in section s2 must exist");

  // Activate the reading mark on that unit, as a user click would.
  const clicked = activateOnUnit(document, shadow, units, units.indexOf(activeUnit));
  assert.ok(clicked.classList.contains("sr-on"), "expected the clicked unit to be active");

  CSR.teardownOverlay();
  assert.strictEqual(document.getElementById("csr-overlay-host"), null, "teardown must remove the overlay");

  window.__csr.scrollByLog.length = 0;
  const reEntry = CSR.renderOverlay(article);

  // DESIRED (issue #7): re-entering restores the active mark's section by
  // anchor, i.e. the reader is positioned below the top (section s2).
  assert.ok(
    reEntry.scroll.scrollTop > 0,
    "expected reader to scroll to the active mark's section (s2), not to the top",
  );
});

test("teardown restores the page scroll captured on enter (bidirectional)", () => {
  const { window, document, CSR } = fresh();
  const page = document.documentElement;

  page.scrollTop = 900;
  assert.strictEqual(window.scrollY, 900, "shim scrollY must track document scrollTop");

  CSR.renderOverlay(makeArticle(document)); // enter: capture page scroll (~900)
  const host = document.getElementById("csr-overlay-host");
  assert.ok(host && host.id === "csr-overlay-host", "overlay must be open");

  page.scrollTop = 250; // position changed between capture and restore

  CSR.teardownOverlay(); // exit: restore ~900
  assert.strictEqual(document.getElementById("csr-overlay-host"), null, "overlay must be removed");
  assert(
    Math.abs(page.scrollTop - 900) <= 1,
    `expected page scroll restored to ~900 after teardown, got ${page.scrollTop}`,
  );
});

test("no active mark => reader opens at the top / first section", () => {
  const { document, CSR } = fresh();
  const { root, scroll } = CSR.renderOverlay(makeArticle(document));

  assert.strictEqual(scroll.scrollTop, 0, "no active mark => scroll container at the top");

  const main = root.querySelector("main");
  const firstHeading = [...main.childNodes].find(
    (n) => n.nodeType === 1 && n.tagName === "H2",
  );
  assert.ok(firstHeading, "first section heading exists");
  assert.strictEqual(firstHeading.id, "s1", "first section is s1");
});

test("teardown with no captured position does not crash or restore anything", () => {
  const { document, CSR } = fresh();

  // Nothing was ever entered.
  assert.doesNotThrow(() => CSR.teardownOverlay());
  assert.strictEqual(document.getElementById("csr-overlay-host"), null);

  // Entered, but nothing was captured: no active mark, untouched page scroll.
  const page = document.documentElement;
  page.scrollTop = 123;
  CSR.renderOverlay(makeArticle(document));
  assert.doesNotThrow(() => CSR.teardownOverlay());
  assert.strictEqual(document.getElementById("csr-overlay-host"), null);
});

test("location maps by section id/anchor across differently structured publisher and reader DOMs", () => {
  const { window, document, CSR } = fresh();

  // Simulated publisher page: same logical sections, different wrapper
  // markup and a different visual order. Only section ids travel into the
  // reader; the publisher DOM itself is never consulted for location.
  const publisherPage = document.createElement("div");
  publisherPage.id = "publisher-page";
  const pubB = document.createElement("section");
  pubB.id = "pub-sec-b";
  pubB.textContent = "publisher B (visual order 1)";
  const pubA = document.createElement("div");
  pubA.id = "pub-sec-a";
  pubA.textContent = "publisher A (visual order 2)";
  publisherPage.appendChild(pubB);
  publisherPage.appendChild(pubA);
  document.body.appendChild(publisherPage);

  // Reader article: identical ids, reader-chosen order (A then B), rebuilt DOM.
  const article = {
    title: "Test Article",
    sections: [
      { id: "sec-a", title: "Section A", content: contentWith(document, ["Alpha text."]) },
      { id: "sec-b", title: "Section B", content: contentWith(document, ["Beta text."]) },
    ],
  };

  const { shadow, root, scroll } = CSR.renderOverlay(article);
  assert.ok(shadow.getElementById("sec-a"), "reader renders heading anchor sec-a");
  assert.ok(shadow.getElementById("sec-b"), "reader renders heading anchor sec-b");

  const main = root.querySelector("main");
  const units = shadow.querySelectorAll(".sr-unit");
  assert.strictEqual(units.length, 2, "one unit per section in this fixture");

  // The active unit lives in reader section "sec-b" (reader position 2).
  assert.strictEqual(
    sectionIdOfUnit(units[1], main),
    "sec-b",
    "anchor resolved from the reader heading, not publisher markup",
  );

  units[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.ok(units[1].classList.contains("sr-on"), "expected the clicked unit to be active");

  CSR.teardownOverlay();
  assert.strictEqual(document.getElementById("csr-overlay-host"), null);

  window.__csr.scrollByLog.length = 0;
  const reEntry = CSR.renderOverlay(article);

  // DESIRED: scroll to sec-b by anchor id (reader position 2 => below top),
  // not to the top and not according to publisher DOM order/pixels.
  assert.ok(
    reEntry.scroll.scrollTop > 0,
    "expected scroll to section sec-b by anchor id, not the top",
  );
});
