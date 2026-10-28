// Tests for issue #10 "adaptive figure borders".
//
// Figures + TABLES (preserved blocks) that overshoot the 72ch reader column
// must become ADAPTIVE: max-width: 100% + overflow-x: auto so they scroll
// horizontally instead of breaking the layout. img/svg inside figures are
// left alone (they already scale via width: 100%).
//
// The fix belongs in render.js STYLE (Shadow DOM stylesheet) and/or the
// renderOverlay wrapper logic. Targets: .csr-page figure, .csr-page table.
//
// CONTRACT exercised by this suite (not yet implemented in
// content/render.js => suite is RED until the fix lands):
//
//   a. The shadow stylesheet carries `max-width: 100%` + `overflow-x: auto`
//      rules for `.csr-page figure` and `.csr-page table`.
//   b. renderOverlay() clamps preserved blocks (table / figure) whose
//      computed width overshoots the column by applying inline
//      `max-width: 100%` and `overflow-x: auto`.
//   c. img/svg inside figures are untouched: no max-width / overflow-x clamp
//      forced on them (width: 100% comes from the stylesheet only).
//   d. Blocks that do not overshoot are rendered unchanged (no inline clamp,
//
// Runs under `node --test` with a hand-rolled DOM shim
// (test/helpers/dom-shim.js). No jsdom, no network, no real timers.
//
// Source is loaded via fs.readFileSync + new Function sandbox with a live
// window/document; window.CSR is captured after content/common.js and
// content/render.js evaluate (same load order as manifest.json content_scripts).
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeWindow } = require("./helpers/dom-shim.js");

const ROOT = path.join(__dirname, "..");
const COMMON_SRC = fs.readFileSync(path.join(ROOT, "content", "common.js"), "utf8");
const RENDER_SRC = fs.readFileSync(path.join(ROOT, "content", "render.js"), "utf8");

// URL is the Node global URL (same realm the content scripts run in).
const URL = globalThis.URL;

// Builds a fresh sandbox per test: installs common.js + render.js into a
// shim window/document and returns the environment plus a render helper.
function newEnvironment() {
  const shim = makeWindow();
  const { window, document, getComputedStyle: gcs, ResizeObserver, MutationObserver, requestAnimationFrame } = shim;

  // common.js creates window.CSR; renderOverlay depends on readingMark and
  // citationPeek being attached to it (stubbed here -- out of scope for this issue).
  window.CSR = window.CSR || {};
  window.CSR.readingMark = { attach() {}, detach() {} };
  window.CSR.citationPeek = { attach() {}, detach() {} };

  // Load scholarly-reader first (required by render.js)
  const SCHOLARLY_SRC = fs.readFileSync(path.join(ROOT, "scholarly-reader", "dist", "scholarly-reader.classic.js"), "utf8");
  // Sandbox: scholarly-reader, common.js then render.js, exactly as manifest content_scripts order.
  const installer = new Function(
    "window",
    "document",
    "Node",
    "getComputedStyle",
    "URL",
    "ResizeObserver",
    "MutationObserver",
    "requestAnimationFrame",
    SCHOLARLY_SRC + "\n" + COMMON_SRC + "\n" + RENDER_SRC
  );
  installer(
    window,
    document,
    shim.Node,
    gcs,
    URL,
    ResizeObserver,
    MutationObserver,
    requestAnimationFrame
  );

  return {
    shim,
    window,
    document,
    gcs,
    CSR: window.CSR,
  };
}

function renderArticle(env, contents) {
  const { document, CSR } = env;
  const article = {
    title: "Test Article",
    venueLine: "Test Journal",
    authors: "A. N. Author",
    sections: contents.map((content, i) => ({
      title: "Section " + (i + 1),
      id: "sec-" + (i + 1),
      content,
    })),
    bibliography: [],
  };
  return CSR.renderOverlay(article);
}

function p(doc, text) {
  const el = doc.createElement("p");
  el.textContent = text;
  return el;
}

function tableWithCell(doc, text) {
  const table = doc.createElement("table");
  const tbody = doc.createElement("tbody");
  const tr = doc.createElement("tr");
  const td = doc.createElement("td");
  td.textContent = text;
  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  return table;
}

function cssOf(shadow) {
  const style = shadow.querySelector("style");
  assert.ok(style, "shadow root should contain a <style> element");
  return style.textContent;
}

// Collapses all whitespace so rule/order-independent substring checks are robust.
function compact(css) {
  return css.replace(/\s+/g, "");
}

function ruleBody(css, selectorRegex) {
  const m = selectorRegex.exec(css);
  assert.ok(m, `expected stylesheet rule matching ${selectorRegex}`);
  return m[1];
}

describe("issue #10: adaptive figure borders", () => {
  describe("(a) shadow stylesheet", () => {
    it("contains max-width: 100% + overflow-x: auto for .csr-page figure and .csr-page table", () => {
      const env = newEnvironment();
      const shadow = renderArticle(env, [p(env.document, "Body text.")]).shadow;
      const c = compact(cssOf(shadow));

      assert.ok(
        c.includes(".csr-pagefigure{max-width:100%;overflow-x:auto"),
        ".csr-page figure must carry max-width: 100% + overflow-x: auto"
      );
      assert.ok(
        c.includes(".csr-pagetable{max-width:100%;overflow-x:auto"),
        ".csr-page table must carry max-width: 100% + overflow-x: auto"
      );

      // Figures keep their border styling (adaptive overflow is added on top).
      // Grab the first `.csr-page figure` rule body so the check is
      // order-independent (border follows `background:` in the source rule).
      const figRule = ruleBody(cssOf(shadow), /figure\s*\{([^}]*)\}/);
      assert.ok(figRule.includes("border:1px solid #CBD6D3"), ".csr-page figure border rule must be preserved");

      // img/svg inside figures keep their existing rule: width: 100%, no overflow clamp.
      const imgBody = ruleBody(cssOf(shadow), /figure\s*img\s*\{([^}]*)\}/);
      assert.ok(imgBody.includes("width:100%"), "figure img must keep width: 100%");
      assert.ok(!imgBody.includes("overflow-x"), "figure img must not get overflow-x");
      const objectBody = ruleBody(cssOf(shadow), /figure\s*object\s*\{([^}]*)\}/);
      assert.ok(!objectBody.includes("overflow-x"), "figure object must not get overflow-x");
    });
  });

  describe("(b) oversized preserved blocks get clamped", () => {
    it("clamps an oversized preserved table", () => {
      const env = newEnvironment();
      const { document, gcs } = env;

      const table = tableWithCell(
        document,
        "A very wide preserved table that must not break the 72ch column."
      );
      // Simulate the publisher table computing to a width far beyond 72ch.
      gcs.set(table, { width: "1200px" });

      const { shadow } = renderArticle(env, [table]);

      const out = shadow.querySelector(".csr-page table");
      assert.ok(out, "preserved table should render inside .csr-page");
      assert.strictEqual(
        out.style.maxWidth,
        "100%",
        "oversized table must be clamped to max-width: 100%"
      );
      assert.strictEqual(
        out.style.overflowX,
        "auto",
        "oversized table must be scrollable via overflow-x: auto"
      );
    });

    it("clamps an oversized figure", () => {
      const env = newEnvironment();
      const { document, gcs } = env;

      const figure = env.document.createElement("figure");
      const img = env.document.createElement("img");
      img.src = "fig.png";
      img.alt = "Wide figure";
      figure.appendChild(img);
      // Simulate the figure computing to a width far beyond 72ch.
      gcs.set(figure, { width: "1400px" });

      const { shadow } = renderArticle(env, [figure]);

      const out = shadow.querySelector(".csr-page figure");
      assert.ok(out, "oversized figure should render inside .csr-page");
      assert.strictEqual(out.style.maxWidth, "100%");
      assert.strictEqual(out.style.overflowX, "auto");
    });
  });

  describe("(c) img/svg inside figures are left alone", () => {
    it("does not force a max-width / overflow-x clamp on images", () => {
      const env = newEnvironment();
      const { document, gcs } = env;

      const figure = env.document.createElement("figure");
      const img = env.document.createElement("img");
      img.src = "fig.png";
      img.alt = "Example";
      figure.appendChild(img);
      const svg = env.document.createElement("svg");
      svg.setAttribute("aria-label", "chart");
      figure.appendChild(svg);
      const caption = env.document.createElement("figcaption");
      caption.textContent = "Figure 1.";
      figure.appendChild(caption);

      // Even an oversized image must not receive the overflow clamp.
      gcs.set(img, { width: "2000px" });

      const { shadow } = renderArticle(env, [figure]);

      const imgOut = shadow.querySelector(".csr-page figure img");
      assert.ok(imgOut, "image should be preserved inside the figure");
      assert.strictEqual(
        imgOut.style.maxWidth ?? "",
        "",
        "no max-width clamp forced on figure img"
      );
      assert.strictEqual(
        imgOut.style.overflowX ?? "",
        "",
        "no overflow-x clamp forced on figure img"
      );

      const svgOut = shadow.querySelector(".csr-page figure svg");
      assert.ok(svgOut, "svg should be preserved inside the figure");
      assert.strictEqual(svgOut.style.maxWidth ?? "", "", "no clamp on figure svg");
      assert.strictEqual(svgOut.style.overflowX ?? "", "", "no overflow clamp on figure svg");

      // The figure itself is not oversized here, so it keeps its stylesheet styling only.
      const figOut = shadow.querySelector(".csr-page figure");
      assert.strictEqual(figOut.style.maxWidth ?? "", "", "no clamp on normally sized figure");
      assert.strictEqual(figOut.style.overflowX ?? "", "", "no overflow on normally sized figure");
    });
  });

  describe("(d) no overshoot => no harm", () => {
    it("leaves normally sized blocks unchanged", () => {
      const env = newEnvironment();
      const { document, gcs } = env;

      const table = tableWithCell(document, "Normal sized table.");
      // Computed width well inside the 72ch column (~576-1152px at 16px).
      gcs.set(table, { width: "400px" });

      const figure = env.document.createElement("figure");
      figure.appendChild(env.document.createTextNode("A figure."));

      const { shadow } = renderArticle(env, [table, figure]);

      const out = shadow.querySelector(".csr-page table");
      assert.ok(out);
      assert.strictEqual(out.style.maxWidth ?? "", "", "no clamp on normally sized table");
      assert.strictEqual(
        out.style.overflowX ?? "",
        "",
        "no overflow on normally sized table"
      );

      const figOut = shadow.querySelector(".csr-page figure");
      assert.ok(figOut);
      assert.strictEqual(figOut.style.maxWidth ?? "", "", "no clamp on figure without overshoot");
      assert.strictEqual(figOut.style.overflowX ?? "", "", "no overflow on figure without overshoot");

      // General rendering is intact: header, page column, figure borders.
      assert.strictEqual(
        shadow.querySelector(".csr-page header h1").textContent,
        "Test Article"
      );
      assert.ok(shadow.querySelector(".csr-page"), ".csr-page column present");
      const figRule = ruleBody(cssOf(shadow), /figure\s*\{([^}]*)\}/);
      assert.ok(figRule.includes("border:1px solid #CBD6D3"), "figure border rule intact");
    });
  });
});
