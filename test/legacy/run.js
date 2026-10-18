#!/usr/bin/env node
/**
 * paper-digest pipeline tests.
 *
 * Plain-Node assert suite (no framework): one file, no network, runs against
 * the fixtures in test/fixtures/. Run from the repo root:
 *
 *   node test/run.js
 *
 * Exit code is non-zero if any assertion fails.
 */

import assert from "node:assert";
import fs from "node:fs";
import { join } from "node:path";

import { extractTextFromHtml } from "../src/cli.js";
import { parseFigures } from "../src/fetch.js";
import { render } from "../src/render.js";
import { extractMarkdown } from "../src/llm.js";
import { digestSource } from "../src/digest.js";
import { loadConfig } from "../src/llm.js";

const ROOT = join(process.cwd(), "test");
const FIX = join(ROOT, "fixtures");
const TMPL = join(process.cwd(), "assets", "template.html");

let passes = 0;
let failures = 0;

const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(
        result.then(
          () => {
            passes += 1;
            console.log("PASS " + name);
          },
          (e) => {
            failures += 1;
            console.log("FAIL " + name + " — " + e.message);
            console.log("   stack: " + (e.stack || "").split("\n").slice(0, 3).join(" | "));
          },
        ),
      );
    } else {
      passes += 1;
      console.log("PASS " + name);
    }
  } catch (e) {
    failures += 1;
    console.log("FAIL " + name + " — " + e.message);
  }
}

function read(f) {
  return fs.readFileSync(join(FIX, f), "utf8");
}

function renderHtml(digest, source = {}) {
  const { placeholders } = render(digest, source);
  let h = fs.readFileSync(TMPL, "utf8");
  for (const [token, value] of Object.entries(placeholders)) h = h.split(token).join(value);
  return h.replace("const MAP = {{MAP}};", "const MAP = {};");
}

const sectionsOrder = ["mot", "core", "diff", "eval", "icymi", "judge", "src"];

////////////////////////////////////////////////////////////////
// I1 — extracted source text
////////////////////////////////////////////////////////////////
test("I1 arxiv-sample: title first, no chrome before/after", () => {
  const out = extractTextFromHtml(read("arxiv-sample.html"));
  assert.ok(out.startsWith("# Title: Sample Paper on Local Learning"), "title is first: " + JSON.stringify(out.slice(0, 60)));
  const beforeTitle = out.slice(0, out.indexOf("Title:"));
  assert.ok(!/Report GitHub Issue|Funder:|nonprofit/.test(beforeTitle), "chrome before title: " + JSON.stringify(beforeTitle));
  const afterRefs = out.slice(out.indexOf("5 References"));
  assert.ok(!/Instructions for reporting errors|Report GitHub Issue/.test(afterRefs), "chrome after references");
});

test("I1 arxiv-sample: Table II region serialised as pipe rows", () => {
  const out = extractTextFromHtml(read("arxiv-sample.html"));
  assert.ok(out.includes("Table II: Ablation results."), "Table II caption present");
  assert.ok(out.includes("| Setting | CIFAR-10 | SVHN |"), "Table II header row");
  assert.ok(out.includes("| No folding | 74.00 | 90.00 |"), "Table II body row");
});

test("I1 localtrain: first 60 lines (see report for output)", () => {
  const out = extractTextFromHtml(read("localtrain.html"));
  const lines = out.split("\n").slice(0, 60);
  assert.ok(lines.length > 0, "extractor produced output");
  assert.ok(lines.some((l) => /# LocalTrain/.test(l)), "title present");
  console.log("    --- first 60 lines of localtrain extraction ---");
  console.log("    " + lines.join("\n    "));
  console.log("    --- end ---");
});

test("I1 no mojibake: non-ASCII (× ≈ ±) survives extraction", () => {
  assert.strictEqual(extractTextFromHtml("<p>1.86 \u00d7, \u2248, \u00b1</p>"), "1.86 ×, ≈, ±");
});

test("I1 each inline equation appears once (<math alttext>)", () => {
  const html =
    "<article class='ltx_document'><p>Gain <math alttext='1.86 \\times'>1.86 times</math> and risk <math alttext='s \\ge 0'>s &ge; 0</math>.</p></article>";
  const out = extractTextFromHtml(html);
  const eq1 = "\\(1.86 \\times\\)";
  const eq2 = "\\(s \\ge 0\\)";
  assert.strictEqual(out.split(eq1).length - 1, 1, "first equation once");
  assert.strictEqual(out.split(eq2).length - 1, 1, "second equation once");
  assert.ok(!out.includes("1.86 times"), "rendered form dropped");
  assert.ok(!out.includes("&ge;"), "rendered form dropped");
});

////////////////////////////////////////////////////////////////
// I2 — figure list and rendering
////////////////////////////////////////////////////////////////
test("I2 localtrain: figure list has exactly two entries", () => {
  const figs = parseFigures(read("localtrain.html"), "https://localhost/");
  assert.strictEqual(figs.length, 2, "count: " + JSON.stringify(figs));
  assert.deepStrictEqual(figs[0], { n: "1", dataA: "S2.F1", caption: "Fig. 1: One CNN layer and its local supervision. Dashed paths retain operands; the local head also updates V. No convolutional input gradient is sent to earlier layers.", url: "", svg: "" });
  assert.deepStrictEqual(figs[1].n, "2");
  assert.deepStrictEqual(figs[1].dataA, "S3.F2");
  assert.strictEqual(figs[1].url, "");
});

test("I2 arxiv-sample: figures only, tables excluded, SVG serialised, URLs resolved", () => {
  const figs = parseFigures(read("arxiv-sample.html"), "https://arxiv.org/html/2610.17099");
  assert.strictEqual(figs.length, 3, "count: " + JSON.stringify(figs));
  assert.ok(figs.every((f) => !/TABLE/i.test(f.caption)), "no tables listed");
  const f1 = figs[0];
  assert.strictEqual(f1.n, "S2.F1");
  assert.strictEqual(f1.dataA, "S2.F1");
  assert.strictEqual(f1.url, "");
  assert.ok(f1.svg.includes('fill="#0E6B73"'), "CSS custom property resolved to literal colour: " + f1.svg);
  assert.ok(f1.svg.includes('stroke="#16252C"'), "stroke colour resolved");
  assert.strictEqual(figs[1].url, "https://arxiv.org/html/fig2.pdf", "object data resolved");
  assert.strictEqual(figs[2].url, "https://arxiv.org/html/fig3.png", "img src resolved");
});

test("I2 render: inline-SVG figure inlined into the figure, scaled to column width", async () => {
  const md = read("handwritten.md");
  const { metadata, body } = extractMarkdown(md);
  const sections = [];
  // reuse splitSections via a tiny inline re-implementation to avoid coupling:
  const { splitSections } = await import("../src/digest.js");
  const all = splitSections(body);
  const digest = { ...metadata, sections: all, body, raw: md };
  const svg = '<svg width="400" height="200"><rect width="400" height="200" fill="#0E6B73"/><text x="50" y="100" fill="white">Fig. 1 diagram</text></svg>';
  const h = renderHtml(digest, {
    figures: [{ n: "1", dataA: "S2.F1", caption: "Fig. 1: diagram", url: "", svg }],
    baseUrl: "https://arxiv.org/html/2601.00001",
  });
  const f1 = h.slice(h.indexOf('data-n="1"'), h.indexOf("</figure>", h.indexOf('data-n="1"')));
  assert.ok(f1.includes("<svg"), "SVG inlined");
  assert.ok(/<svg width="100%" height="auto"/.test(f1), "scaled to column width");
  assert.ok(/viewBox="0 0 400 200"/.test(f1), "viewBox added so it scales");
  assert.ok(f1.includes("Fig. 1 diagram"), "svg content retained");
});

test("I2 render: figure without image or SVG keeps arxiv fallback link ingredients", async () => {
  const { splitSections } = await import("../src/digest.js");
  const md = read("handwritten.md");
  const { metadata } = extractMarkdown(md);
  const digest = {
    ...metadata,
    sections: [{ id: "core", title: "Core idea", content: '<figure data-n="2" data-a="S9.F9"><figcaption>Fig. 2: nothing.</figcaption></figure>', confidence: 80 }],
    body: "",
    raw: "",
  };
  const h = renderHtml(digest, {
    figures: [{ n: "2", dataA: "S9.F9", caption: "", url: "", svg: "" }],
    baseUrl: "https://arxiv.org/html/2601.00001",
  });
  assert.ok(/const BASE = "https:\/\/arxiv.org\/html\/2601\.00001"/.test(h), "BASE points at arxiv html");
  assert.ok(h.includes('data-a="S9.F9"'), "data-a anchor id present");
  assert.ok(/new URL\(MAP\[n\], BASE \|\| window\.location\.origin\)/.test(h), "fallback link built from BASE + data-a");
});

test("I2 render: raster figure (img url) added server-side", async () => {
  const { splitSections } = await import("../src/digest.js");
  const md = read("handwritten.md");
  const { metadata, body } = extractMarkdown(md);
  const digest = { ...metadata, sections: splitSections(body), body, raw: md };
  const h = renderHtml(digest, {
    figures: [{ n: "1", dataA: "S2.F1", caption: "Fig. 1", url: "https://arxiv.org/html/fig1.png", svg: "" }],
    baseUrl: "https://arxiv.org/html/2601.00001",
  });
  const f1 = h.slice(h.indexOf('data-n="1"'), h.indexOf("</figure>", h.indexOf('data-n="1"')));
  assert.ok(/<img loading="lazy" alt="Figure 1" src="https:\/\/arxiv.org\/html\/fig1\.png">/.test(f1), "raster img inlined");
});

////////////////////////////////////////////////////////////////
// I3 — Sources paragraph once
////////////////////////////////////////////////////////////////
test("I3 render: each of the seven sections appears exactly once, no .cite", async () => {
  const md = read("handwritten.md");
  const { metadata, body } = extractMarkdown(md);
  const { splitSections } = await import("../src/digest.js");
  const digest = { ...metadata, sections: splitSections(body), body, raw: md };
  const h = renderHtml(digest, { figures: [], baseUrl: "" });
  assert.strictEqual((h.match(/<p class="cite">/g) || []).length, 0, "no citation paragraphs rendered");
  for (const id of sectionsOrder) {
    const n = (h.match(new RegExp('id="' + id + '"', "g")) || []).length;
    assert.strictEqual(n, 1, id + " section appears once (got " + n + ")");
  }
  const srcText = "I read the full arXiv HTML text including tables and references.";
  assert.strictEqual((h.match(srcText.replace(/[.]/g, "\\.")) || []).length, 1, "sources paragraph once");
});

////////////////////////////////////////////////////////////////
// I4 — Evaluation as per-result items
////////////////////////////////////////////////////////////////
test("I4 render: Evaluation section has four .item blocks and no .prose wrapper", async () => {
  const md = read("handwritten.md");
  const { metadata, body } = extractMarkdown(md);
  const { splitSections } = await import("../src/digest.js");
  const digest = { ...metadata, sections: splitSections(body), body, raw: md };
  const h = renderHtml(digest, { figures: [], baseUrl: "" });
  const evalStart = h.indexOf('id="eval"');
  const evalEnd = h.indexOf('id="icymi"', evalStart);
  const slice = h.slice(evalStart, evalEnd);
  assert.strictEqual((slice.match(/<div class="item">/g) || []).length, 4, "four result items");
  assert.strictEqual((slice.match(/<div class="prose">/g) || []).length, 0, "no prose wrapper in eval");
});

////////////////////////////////////////////////////////////////
// I5 — frontmatter commas
////////////////////////////////////////////////////////////////
test("I5 frontmatter: commas keep their following space; only authors is a list", () => {
  const fm =
    "---\ntitle: T\nauthors: A, B\nvenue: v\nid: 1\nwhatRead: full text, no code, no supplementary material\nverdict: The paper is good, and it shows (boundaries, and mechanisms (compact, tiled)), end.\noverallConfidence: 80\n---\n\n## Motivation (Confidence: 80%)\n\nbody.\n";
  const { metadata } = extractMarkdown(fm);
  assert.strictEqual(typeof metadata.verdict, "string", "verdict must stay scalar");
  assert.strictEqual(
    metadata.verdict,
    "The paper is good, and it shows (boundaries, and mechanisms (compact, tiled)), end.",
  );
  assert.strictEqual(metadata.whatRead, "full text, no code, no supplementary material");
  assert.deepStrictEqual(metadata.authors, ["A", "B"]);
  const digest = { ...metadata, sections: [], body: "body.", raw: fm };
  const h = renderHtml(digest, { figures: [], baseUrl: "" });
  assert.ok(h.includes("boundaries, and mechanisms"), "comma + space preserved in rendered verdict");
});

////////////////////////////////////////////////////////////////
// I6 — math and line breaks
////////////////////////////////////////////////////////////////
test("I6 render: display math -> \\[...\\], inline \\(...\\) untouched, \\\\ preserved, single newline joined", async () => {
  const content =
    "Inline: \\(x_i \\le y\\) and \\(a < b\\).\n\n$$\n\\begin{aligned}\nh_t &= 1,\\\\\\\\ne_t &= 2.\\\\\n\\end{aligned}\n$$\n\nA paragraph with a single newline\ncontinues on the next line as one paragraph.";
  const { splitSections } = await import("../src/digest.js");
  const digest = {
    title: "T", authors: ["A"], venue: "v", id: "1", whatRead: "w", verdict: "v", overallConfidence: 80,
    sections: [{ id: "core", title: "Core idea", content, confidence: 80 }],
    body: "",
    raw: "",
  };
  const h = renderHtml(digest, { figures: [], baseUrl: "" });
  const coreStart = h.indexOf('id="core"');
  const coreEnd = h.indexOf('id="', coreStart + 1);
  const slice = h.slice(coreStart, coreEnd > -1 ? coreEnd : h.length);
  assert.ok(slice.includes("\\["), "display math starts with \\[");
  assert.ok(slice.includes("\\begin{aligned}"), "display math contains \\begin{aligned}");
  assert.ok(slice.includes("\\end{aligned}"), "display math contains \\end{aligned}");
  assert.ok(slice.includes("\\]"), "display math ends with \\]");
  assert.ok(slice.includes("\\\\"), "multi-line \\\\ line breaks preserved");
  assert.ok(slice.includes("\\(x_i \\le y\\)"), "inline \\( ... \\) passes through (MathJax sees the original via the DOM)");
  assert.ok(slice.includes("\\(a &lt; b\\)"), "raw < inside inline math is escaped in HTML (MathJax sees the original via the DOM)");
  assert.ok(
    /<p>A paragraph with a single newline\ncontinues on the next line as one paragraph\.<\/p>/.test(slice),
    "single-newline paragraph stays one paragraph",
  );
});

test("I6 render: < and & inside math are escaped for HTML", async () => {
  const content = "Inline: \\(a < b \\& c\\)). Display: $$x = y \\& z$$.";
  const digest = {
    title: "T", authors: ["A"], venue: "v", id: "1", whatRead: "w", verdict: "v", overallConfidence: 80,
    sections: [{ id: "core", title: "Core idea", content, confidence: 80 }],
    body: "",
    raw: "",
  };
  const h = renderHtml(digest, { figures: [], baseUrl: "" });
  const slice = h.slice(h.indexOf('id="core"'), h.indexOf("</main>"));
  assert.ok(slice.includes("\\(a &lt; b \\&amp; c\\)"), "inline math escaped");
  assert.ok(slice.includes("\\[x = y \\&amp; z\\]"), "display math escaped");
  const pStart = slice.indexOf("<p>");
  const pEnd = slice.indexOf("</p>", pStart);
  const pInner = slice.slice(pStart + 3, pEnd);
  assert.ok(!/<[a-z]/.test(pInner), "no raw < tag from math");
});

////////////////////////////////////////////////////////////////
// I7 — output contract
////////////////////////////////////////////////////////////////
test("I7 runner: extractFinal then extractDraft fallback, truncation reported, fix-warning, rawResponse carried", async () => {
  const FM =
    "---\ntitle: t\nauthors: a\nvenue: v\nid: 1\nwhatRead: w\nverdict: v\noverallConfidence: 80\n---\n\n## Motivation (Confidence: 80%)\n\nbody.";
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  const source = { paperText: "x", figures: [], baseUrl: "", whatRead: "x" };
  try {
    const d1 = await digestSource(source, { client: { chat: async () => "<notes>n</notes><draft>" + FM + "</draft><check>Fixes to apply: 0</check><final>" + FM + "</final>" } });
    assert.ok(d1.raw.includes("<notes>") && d1.raw.includes("<draft>") && d1.raw.includes("<check>") && d1.raw.includes("<final>"), "raw stores all blocks");
    const d2 = await digestSource(source, { client: { chat: async () => "<notes>n</notes><draft>" + FM + "</draft><check>Fixes to apply: 0</check>" } });
    assert.ok(d2.raw.includes("<notes>") && d2.raw.includes("<draft>") && d2.raw.includes("<check>"), "raw stores all blocks when no final");
    assert.ok(!d2.raw.includes("<final>"), "no <final> in raw when check is clean");
    let threw = false;
    try {
      await digestSource(source, { client: { chat: async () => "<notes>n</notes><draft>" + FM.slice(0, 10) } });
    } catch (e) {
      threw = true;
      assert.ok(/no <final> or <draft> block/.test(e.message), "truncation reported: " + e.message);
    }
    assert.ok(threw, "truncated response must throw");
    warnings.length = 0;
    const d4 = await digestSource(source, { client: { chat: async () => "<notes>n</notes><draft>" + FM + "</draft><check>Fixes to apply: 2</check>" } });
    assert.ok(d4.raw.includes(FM.trimEnd()), "draft document preserved inside raw response");
    assert.ok(warnings.some((w) => /Fixes to apply/.test(w)), "warning mentions Fixes to apply: " + warnings.join("|"));
    console.warn = origWarn;
  } finally {
    console.warn = origWarn;
  }
});

test("I7 max_tokens high enough for notes+draft+check+final", () => {
  assert.ok(loadConfig().max_tokens >= 4096, "max_tokens = " + loadConfig().max_tokens);
});

test("I7 cli runDigest stores raw response alongside the digest", async () => {
  const FM =
    "---\ntitle: t\nauthors: a\nvenue: v\nid: 1\nwhatRead: w\nverdict: v\noverallConfidence: 80\n---\n\n## Motivation (Confidence: 80%)\n\nbody.\n## Core idea (Confidence: 80%)\n\nc.\n## Distinguishing factor (Confidence: 80%)\n\nd.\n## Evaluation and conclusions (Confidence: 80%)\n\n**R.** r.\n## In case you missed it (Confidence: 80%)\n\n- [pos] e.\n## Cautious judgement (Confidence: 80%)\n\n| Question | Answer | Confidence |\n| --- | --- | --- |\n| Fair comparison to external baselines? | x | 80% |\n| Invents its own FoM? | x | 80% |\n| Rewrite of an existing idea? | x | 80% |\n| Reliable enough to reuse? | x | 80% |\n## Sources and limits (Confidence: 80%)\n\ns.\n";
  const response = "<notes>ledger</notes><draft>" + FM + "</draft><check>Fixes to apply: 0</check><final>" + FM + "</final>";
  const htmlSource =
    "<!doctype html><html><head><meta charset='utf-8'><title>x</title></head><body><article class='ltx_document'><h1 class='title mathjax'>Title: T</h1><p>body</p></article></body></html>";
  const { runDigest } = await import("../src/cli.js");
  await fs.promises.rm(join(process.cwd(), "test", "tmp-out"), { recursive: true, force: true });
  const result = await runDigest(htmlSource, { outDir: join(process.cwd(), "test", "tmp-out"), client: { chat: async () => response } });
  const respText = await fs.promises.readFile(result.mdPath.replace(/\.md$/, ".response.txt"), "utf8");
  assert.strictEqual(respText, response);
  assert.ok(respText.includes("<notes>") && respText.includes("<check>") && respText.includes("<final>"));
});

////////////////////////////////////////////////////////////////
(async () => {
  await Promise.all(pending);
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
