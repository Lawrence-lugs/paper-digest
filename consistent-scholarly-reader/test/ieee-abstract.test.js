// Tests for the IEEE parser: the abstract must be included in reading mode
// and flow through the same pipeline as the body sections.
//
// IEEE places the abstract (<div class="abstract-text">) in the page header,
// outside #article and not wrapped in a .section block, so sectionsFrom()
// never saw it: when full text was available the abstract vanished from the
// article toggle. The fix prepends it as its own leading "Abstract" section,
// cloned through the same sanitization pipeline as body sections.
//
// Two contracts are exercised here:
//   a. the abstract surfaces as a block (<p>) under <main>, so the reading
//      mark (which only units .csr-page p / li / blockquote / figcaption /
//      td and display math) can reach it;
//   b. equations survive: MathJax output markup is preserved instead of
//      being collapsed to garbled plain text by textContent.
//
// Runs under `node --test` with a hand-rolled DOM shim (no jsdom, no network).
//
// Source is loaded via fs.readFileSync + new Function sandbox with a live
// window/document; window.CSR is captured after content/common.js and
// content/parsers/ieee.js evaluate.
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeWindow } = require("./helpers/dom-shim.js");

const ROOT = path.join(__dirname, "..");
const URL = globalThis.URL;

const COMMON_SRC = fs.readFileSync(path.join(ROOT, "content", "common.js"), "utf8");
const IEEE_SRC = fs.readFileSync(path.join(ROOT, "content", "parsers", "ieee.js"), "utf8");
const IEEE_HTML = fs.readFileSync(path.join(ROOT, "reference", "ieee-1.html"), "utf8");

// Distinctive snippet of this article's abstract (reference/ieee-1.html,
// document 11721447).
const ABSTRACT_MARKER = "gain-cell embedded dynamic random access memory (DRAM)";
const TYPESET_MU = "\u03BC"; // typeset Greek mu produced by MathJax
const RAW_LATEX_MU = "\\mu"; // raw LaTeX source that must NOT leak into text

function newEnvironment() {
  const shim = makeWindow();
  const { window, document, getComputedStyle: gcs } = shim;

  window.CSR = window.CSR || {};

  const installer = new Function(
    "window",
    "document",
    "Node",
    "getComputedStyle",
    "URL",
    COMMON_SRC + "\n" + IEEE_SRC
  );
  installer(window, document, shim.Node, gcs, URL);

  return { shim, window, document, gcs, CSR: window.CSR };
}

function loadIeeePage(env) {
  env.document.documentElement.innerHTML = IEEE_HTML;
}

function ieeeParser(env) {
  const parser = env.CSR.parsers.find((p) => p.id === "ieee");
  assert.ok(parser, "ieee parser must be registered on CSR.parsers");
  return parser;
}

// Returns true if the abstract section's content is headed by a <p> block,
// which is what makes it a reading-mark unit (see readingMark.js ALL selector).
function abstractIsReadingMarkUnit(content) {
  const first = content && content.firstChild;
  return first && first.tagName === "P";
}

describe("ieee parser: abstract included in reading mode", () => {
  it("registers and detects ieeexplore.ieee.org only", () => {
    const env = newEnvironment();
    const parser = ieeeParser(env);

    assert.strictEqual(
      parser.detect(env.document, { url: "https://ieeexplore.ieee.org/document/11721447" }),
      true,
      "must detect ieeexplore.ieee.org document URLs"
    );
    assert.strictEqual(parser.detect(env.document, { url: "https://example.com/" }), false, "must not detect other hosts");
  });

  it("prepends the abstract as a reading-mark-reachable first section when full text exists", () => {
    const env = newEnvironment();
    loadIeeePage(env);

    const article = ieeeParser(env).parse(env.document, {
      url: "https://ieeexplore.ieee.org/document/11721447",
    });

    assert.ok(article, "parse must return an article for the captured page");
    assert.strictEqual(article.site, "ieee");
    assert.ok(article.title, "title should be harvested from citation/og meta tags");
    assert.ok(Array.isArray(article.sections) && article.sections.length >= 2, "should yield abstract + body sections");

    // The abstract comes first.
    assert.strictEqual(article.sections[0].id, "abstract");
    assert.strictEqual(article.sections[0].title, "Abstract");

    // (a) Reading-mark reachability: content must surface as a <p> block,
    // not bare inline text under <main>.
    assert.ok(
      abstractIsReadingMarkUnit(article.sections[0].content),
      "abstract section content must be a <p> block so the reading mark can reach it"
    );

    const absText = article.sections[0].content.textContent;
    assert.ok(absText.includes(ABSTRACT_MARKER), "abstract section must carry the article's abstract text");

    // (b) Equations: MathJax typeset glyphs are preserved; raw LaTeX source
    // (from <script type="math/tex">) must not leak into the text.
    assert.ok(absText.includes(TYPESET_MU), "abstract must preserve typeset equation glyphs");
    assert.ok(!absText.includes(RAW_LATEX_MU), "abstract must not contain raw LaTeX source");

    // ...followed by the real body sections in document order.
    const titles = article.sections.map((s) => s.title);
    assert.ok(titles.includes("Introduction"), "body sections must follow the abstract");
  });

  it("falls back to abstract-only when full text is unavailable", () => {
    const env = newEnvironment();
    const { document } = env;

    // Minimal pages with no full-text body (none of the BODY_SELECTORS or
    // article/main/[role=main] roots match): parse must fall back to the
    // abstract instead of returning null. Covers both abstractText branches:
    // div.abstract-text and meta[name=description].
    const cases = [
      {
        name: "div.abstract-text",
        html: `<html><body><div class="abstract-text"><h2>Abstract:</h2><p>Synthetic abstract text covering the fallback path where IEEE exposes no full text, only the abstract.</p></div></body></html>`,
      },
      {
        name: "meta[name=description]",
        html: `<html><head><meta name="description" content="Meta-description abstract: synthetic text with no full-text body anywhere on the page."></head><body></body></html>`,
      },
    ];

    for (const { name, html } of cases) {
      document.documentElement.innerHTML = html;
      const article = ieeeParser(env).parse(document, { url: "https://ieeexplore.ieee.org/document/1234567" });

      assert.ok(article, `${name}: parse must fall back to abstract-only rather than returning null`);
      assert.strictEqual(article.sections.length, 1, `${name}: exactly one section expected`);
      assert.strictEqual(article.sections[0].id, "abstract", `${name}: section id`);
      assert.strictEqual(article.sections[0].title, "Abstract", `${name}: section title`);
      assert.ok(
        abstractIsReadingMarkUnit(article.sections[0].content),
        `${name}: abstract content must be a <p> block for the reading mark`
      );
      assert.ok(
        article.sections[0].content.textContent.includes("abstract"),
        `${name}: abstract text present`
      );
    }
  });
});
