/**
 * Tests for src/fetch.js (parseFigures, resolve) and the HTML text extractor.
 *
 * The extractor (extractTextFromHtml) currently lives in src/cli.js, not
 * src/fetch.js, as TASK_TESTING.md assumes. The extractor tests below
 * therefore import it from src/cli.js, and the fetch.js import gap is
 * documented explicitly rather than left implicit.
 *
 * parseFigures (src/fetch.js) is DOM-based (linkedom): real figures only,
 * never tables; entries are {n, dataA, caption, url, svg}, with the svg field
 * holding serialised inline <svg> markup (CSS custom properties resolved to
 * literal colours) and url holding an image/object URL resolved against baseUrl.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFigures } from "../src/fetch.js";
import { extractTextFromHtml } from "../src/cli.js";

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures");

function read(name) {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + 1);
  }
  return n;
}

////////////////////////////////////////////////////////////////
// parseFigures (src/fetch.js)
////////////////////////////////////////////////////////////////

test("fetch.js exports parseFigures", () => {
  assert.strictEqual(typeof parseFigures, "function");
});

test(
  "parseFigures: localtrain fixture (fixture 1) yields exactly two figures, no tables, fallback figures",
  () => {
    const html = read("localtrain.html");
    const figures = parseFigures(html, "https://localhost/");

    assert.strictEqual(figures.length, 2, "exactly two figure entries on fixture 1");
    assert.deepStrictEqual(figures.map((f) => f.n), ["1", "2"]);
    assert.deepStrictEqual(figures.map((f) => f.dataA), ["S2.F1", "S3.F2"]);
    assert.ok(
      figures[0].caption.includes("One CNN layer and its local supervision"),
    );
    assert.ok(figures[1].caption.includes("Hardware organization"));

    // tables must never leak into the figure list
    assert.ok(
      figures.every((f) => !/table/i.test(f.caption || "")),
      "no table captions in figure list",
    );

    // figures with neither image nor SVG fall back (empty url and svg)
    assert.strictEqual(figures[0].url, "");
    assert.strictEqual(figures[0].svg, "");
    assert.strictEqual(figures[1].url, "");
    assert.strictEqual(figures[1].svg, "");
  },
);

test(
  "parseFigures: arxiv sample excludes tables, serialises inline SVG, resolves img/object URLs",
  () => {
    const html = read("arxiv-sample.html");
    const baseUrl = "https://arxiv.org/html/2610.17099";
    const figures = parseFigures(html, baseUrl);

    assert.strictEqual(figures.length, 3, "three real figures, no tables");
    assert.ok(
      figures.every((f) => !/TABLE/i.test(f.caption)),
      "no tables listed",
    );
    assert.ok(
      figures.every((f) => f.id !== "S3.T1" && f.id !== "S3.T2"),
      "no table ids",
    );

    // inline SVG: serialised markup with CSS custom properties resolved
    const f1 = figures.find((f) => f.dataA === "S2.F1");
    assert.ok(f1, "figure S2.F1 present");
    assert.ok(f1.svg.includes("<svg"), "inline SVG serialised into svg field");
    assert.ok(
      f1.svg.includes('fill="#0E6B73"'),
      "fill custom property resolved to literal colour",
    );
    assert.ok(
      f1.svg.includes('stroke="#16252C"'),
      "stroke custom property resolved",
    );
    assert.strictEqual(f1.url, "", "SVG figure has no image url");

    // <object data> resolved against baseUrl
    const f2 = figures.find((f) => f.dataA === "S3.F2");
    assert.ok(f2, "figure S3.F2 present");
    assert.strictEqual(f2.url, "https://arxiv.org/html/fig2.pdf", "object url resolved");

    // <img src> resolved against baseUrl
    const f3 = figures.find((f) => f.dataA === "S4.F3");
    assert.ok(f3, "figure S4.F3 present");
    assert.strictEqual(f3.url, "https://arxiv.org/html/fig3.png", "img url resolved");
  },
);

//////////////////////////////////////////////////////////////////
// extractor: extractTextFromHtml (implemented in src/cli.js)
////////////////////////////////////////////////////////////////

test("extractor: arxiv-sample — title first, chrome scoped out, headings marked, tables as pipe rows", () => {
  const text = extractTextFromHtml(read("arxiv-sample.html"));

  assert.ok(
    text.startsWith("# Title: Sample Paper on Local Learning"),
    "title is first with heading marker: " + JSON.stringify(text.slice(0, 60)),
  );
  const beforeTitle = text.slice(0, text.indexOf("Title:"));
  assert.ok(
    !/Report GitHub Issue|Funder:|nonprofit/.test(beforeTitle),
    "no chrome before title",
  );
  const afterRefs = text.slice(text.indexOf("5 References"));
  assert.ok(
    !/Instructions for reporting errors|Report GitHub Issue/.test(afterRefs),
    "no chrome after references",
  );

  // headings with markers
  assert.ok(text.includes("## 1 Introduction"), "h2 heading marked");
  assert.ok(text.includes("## 5 References"), "references heading marked");

  // tables serialised as caption + pipe-separated rows
  assert.ok(text.includes("Table I: Comparison of methods."), "table caption");
  assert.ok(text.includes("| Method | Accuracy |"), "table header row");
  assert.ok(text.includes("| Ours | 76.57% |"), "table body row");
  assert.ok(text.includes("Table II: Ablation results."), "second table caption");
});

test("extractor: each <math> alttext appears once; rendered form dropped", () => {
  const html =
    "<article class='ltx_document'><p>Gain <math alttext='1.86 \\times'>1.86 times</math> and risk <math alttext='s \\ge 0'>s &ge; 0</math>.</p></article>";
  const out = extractTextFromHtml(html);

  assert.strictEqual(out.split("\\(1.86 \\times\\)").length - 1, 1, "first equation once");
  assert.strictEqual(out.split("\\(s \\ge 0\\)").length - 1, 1, "second equation once");
  assert.ok(!out.includes("1.86 times"), "rendered form dropped");
  assert.ok(!out.includes("&ge;"), "rendered form dropped");
});

test("extractor: localtrain — UTF-8 symbols survive (non-LaTeXML HTML falls back to <body>)", () => {
  const text = extractTextFromHtml(read("localtrain.html"));

  assert.ok(text.includes("# LocalTrain:"), "title present with marker");
  assert.ok(text.includes("×"), "multiplication sign survives");
  assert.ok(text.includes("±"), "plus-minus sign survives");
  const CHROME = ["Report GitHub Issue", "arXiv is now an independent nonprofit", "Funder:"];
  for (const chunk of CHROME) {
    assert.ok(!text.includes(chunk), `no arxiv chrome: ${chunk}`);
  }
});

//////////////////////////////////////////////////////////////////
// Gap documentation: extractTextFromHtml is not exported from src/fetch.js
////////////////////////////////////////////////////////////////

test("extractTextFromHtml is implemented in src/cli.js, not exported from src/fetch.js", async () => {
  const fetchMod = await import("../src/fetch.js");
  assert.strictEqual(
    fetchMod.extractTextFromHtml,
    undefined,
    "extractTextFromHtml is not exported from src/fetch.js (it lives in src/cli.js)",
  );
});
