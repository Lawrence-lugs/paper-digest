/**
 * Tests for src/render.js + src/template.js: Markdown digest -> HTML rendering.
 *
 * Structural invariants from TASK_PIPELINE.md:
 *  - each of the seven section bodies appears exactly once (I3)
 *  - Evaluation renders as four .item blocks with no .prose wrapper (I4)
 *  - commas in frontmatter keep their following spaces (I5)
 *  - math placeholders (I6) and figure pipeline (I2 render side)
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractMarkdown } from "../src/llm.js";
import { splitSections, parseIcymi, parseJudge } from "../src/digest.js";
import { render } from "../src/render.js";
import { renderString } from "../src/template.js";

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

const handwritten = read("handwritten.md");
const { metadata, body } = extractMarkdown(handwritten);
const sections = splitSections(body);
// The pipeline attaches section-specific parsed data before rendering.
for (const s of sections) {
  if (s.id === "icymi") s.entries = parseIcymi(s.content);
  if (s.id === "judge") s.rows = parseJudge(s.content);
}
const digest = { ...metadata, sections, raw: handwritten };
const html = await renderString(digest, { figures: [], baseUrl: "" });

test("render: handwritten fixture parses into metadata plus seven sections", () => {
  assert.strictEqual(metadata.title, "A Sample Paper for Digest Rendering Tests");
  assert.deepStrictEqual(metadata.authors, ["Jane Doe", "John Smith"]);
  assert.strictEqual(metadata.venue, "arXiv:2601.00001v1 [cs.AR]");
  assert.strictEqual(metadata.id, "2601.00001");
  assert.strictEqual(metadata.overallConfidence, "80");
  assert.strictEqual(sections.length, 7);
  assert.deepStrictEqual(
    sections.map((s) => s.id),
    ["mot", "core", "diff", "eval", "icymi", "judge", "src"],
  );
});

test("render: each of the seven section bodies appears exactly once (structural invariant)", () => {
  const needles = {
    mot: "small seed set",
    core: "local classifier to each region",
    diff: "regional error expansion and tile folding",
    eval: "headline numbers and they are reproducible within the paper",
    icymi: "lookup tables and a shared reciprocal",
    judge: "power boundaries differ",
    src: "I did not read the appendix",
  };
  for (const [id, needle] of Object.entries(needles)) {
    const section = sections.find((s) => s.id === id);
    assert.ok(section, `section ${id} exists`);
    assert.strictEqual(
      countOccurrences(html, needle),
      1,
      `body of section ${id} rendered exactly once`,
    );
  }
  // every section heading renders exactly once
  for (const id of ["mot", "core", "diff", "eval", "icymi", "judge", "src"]) {
    assert.strictEqual(
      countOccurrences(html, `<h2 class="s" id="${id}"`),
      1,
      `heading ${id} rendered exactly once`,
    );
  }
});

test("render: evaluation section is four .item blocks with no .prose wrapper", () => {
  const evalStart = html.indexOf('<h2 class="s" id="eval"');
  assert.ok(evalStart !== -1, "Evaluation heading present");
  const nextH = html.indexOf("<h2", evalStart + 1);
  const region = nextH !== -1 ? html.slice(evalStart, nextH) : html.slice(evalStart);
  assert.strictEqual(countOccurrences(region, 'class="item"'), 4, "four .item blocks in Evaluation");
  assert.strictEqual(countOccurrences(region, 'class="prose"'), 0, "no .prose wrapper in Evaluation");
});

test("render: commas in frontmatter keep their following spaces", () => {
  assert.ok(
    html.includes(", and the results are promising"),
    "verdict comma+space preserved",
  );
  assert.ok(
    html.includes("dataset, so the generalizability"),
    "verdict comma+space preserved (2)",
  );
  assert.ok(
    html.includes("no code, no supplementary material"),
    "whatRead comma+space preserved",
  );
  assert.ok(!html.includes(",and the results"), "no comma-without-space in verdict");
  assert.ok(!html.includes("no code,no supplementary"), "no comma-without-space in whatRead");
});

test("render: frontmatter placeholders keep scalar values verbatim", () => {
  const commaDigest = {
    title: "T",
    authors: [],
    venue: "",
    id: "",
    whatRead: "no code, no supplementary material",
    verdict: "The paper is good, and thorough, but limited.",
    overallConfidence: 0,
    sections: [],
    raw: "",
  };
  const { placeholders } = render(commaDigest, {});
  assert.strictEqual(
    placeholders["{{VERDICT}}"],
    "The paper is good, and thorough, but limited.",
  );
  assert.strictEqual(
    placeholders["{{WHAT_READ}}"],
    "no code, no supplementary material",
  );
});

test("render: baseUrl flows into the page script as BASE", async () => {
  const out = await renderString(digest, {
    figures: [],
    baseUrl: "https://arxiv.org/html/2610.17099v1",
  });
  assert.ok(out.includes('const BASE = "https://arxiv.org/html/2610.17099v1";'), "BASE set");
});

test("render: math placeholders — display $$ -> \\[...\\], inline \\(...\\) passthrough, multi-line \\\\ kept", () => {
  assert.ok(html.includes("\\[Z = F V"), "display math converted to \\[...\\]");
  assert.ok(
    html.includes("\\mathrm{pre}"),
    "inline math passed through as \\(...\\) (\\mathrm{pre} appears in inline \(E_F = E V_\\mathrm{pre}\))",
  );
  assert.ok(html.includes("\\begin{aligned}"), "multi-line display equation content kept");
  assert.ok(html.includes("\\\\"), "multi-line display equation line breaks kept");
});

test("render: < and & inside restored math are escaped", async () => {
  const mathDigest = {
    title: "Math escaping",
    authors: [],
    venue: "",
    id: "",
    whatRead: "",
    verdict: "",
    overallConfidence: 0,
    sections: [
      { id: "core", title: "Core idea", content: "Range: \\(x < y \\& z\\)." },
    ],
    raw: "",
  };
  const out = await renderString(mathDigest, {});
  // esc() is applied to restored math: & -> &amp; (the LaTeX backslash before
  // it is preserved; MathJax reads the unescaped text from the DOM after
  // entity parsing, i.e. the original \(x < y \& z\)).
  assert.ok(
    out.includes("\\(x &lt; y \\&amp; z\\)"),
    "< and & escaped inside restored math",
  );
  assert.ok(
    !out.includes("\\(x < y \\& z\\)"),
    "raw < not left inside restored math",
  );
});

function figDigest(content) {
  return {
    title: "Figures",
    authors: [],
    venue: "",
    id: "",
    whatRead: "",
    verdict: "",
    overallConfidence: 0,
    sections: [{ id: "core", title: "Core idea", content }],
    raw: "",
  };
}

test("render: raster figure image is inlined into <figure> from source map", async () => {
  const out = await renderString(
    figDigest('<figure data-n="1"><figcaption>Fig. 1 caption</figcaption></figure>'),
    {
      figures: [{ n: 1, dataA: "S2.F1", caption: "Fig. 1", url: "https://cdn.example/fig1.png" }],
      baseUrl: "",
    },
  );
  assert.ok(
    out.includes('<img loading="lazy" alt="Figure 1" src="https://cdn.example/fig1.png">'),
    "raster image inlined",
  );
});

test("render: figure without image or SVG gets baseUrl so the client fallback link begins with https://arxiv.org/html/", async () => {
  const out = await renderString(
    figDigest('<figure data-n="1" data-a="S9.F1"><figcaption>Fig. 9 caption</figcaption></figure>'),
    {
      figures: [{ n: 1, dataA: "S9.F1", caption: "Fig. 9" }],
      baseUrl: "https://arxiv.org/html/2610.17099v1",
    },
  );
  // No server-side image is injected for a figure with neither image nor SVG;
  // the client-side script builds the fallback link from BASE + # + data-a.
  assert.ok(out.includes('const BASE = "https://arxiv.org/html/2610.17099v1";'), "BASE set");
  assert.ok(out.includes('data-a="S9.F1"'), "figure keeps its data-a id");
});

test("render: inline SVG figure is inlined into <figure>", async () => {
  const svg = '<svg width="400" height="200"><rect width="400" height="200"/></svg>';
  const out = await renderString(
    figDigest('<figure data-n="1" data-a="S2.F1"><figcaption>Fig. 1 caption</figcaption></figure>'),
    {
      figures: [{ n: 1, dataA: "S2.F1", caption: "Fig. 1", svg }],
      baseUrl: "",
    },
  );
  // scaleSvg normalises the <svg> tag (width 100%, viewBox from width/height)
  assert.ok(out.includes("<svg"), "inline SVG markup inlined into figure");
  assert.ok(out.includes('viewBox="0 0 400 200"'), "SVG viewBox normalised");
  assert.ok(out.includes('width="100%"'), "SVG scaled to column width");
});
