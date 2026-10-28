/**
 * Agent B — pipeline tests.
 *
 * parseDigest, buildPrompt, filenameFor (pure, run in Node) plus renderContent
 * / sanitizeHtml (math protection, single-$ currency policy, XSS/SVG
 * neutralization), imported after shimming a minimal `window`.
 *
 * Run: node --test test/pipeline/
 */

import "./shim.mjs"; // sets globalThis.window before render.js is imported
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import {
  buildPrompt,
  parseDigest,
  filenameFor,
  extractFinal,
  extractDraft,
} from "../../web/js/pipeline/pipeline.js";

const FM = `---\ntitle: Sample Paper\nauthors: Jane Doe, John Smith\nvenue: arXiv:2610.17099 [cs.AR]\nid: 2610.17099\nwhatRead: arXiv HTML full text\nverdict: A fine paper.\noverallConfidence: 80\n---\n\n## Specific background (Confidence: 90%)\n\nLocal learning means per-layer objectives without cross-layer error propagation; the paper defines this in its preliminaries.\n\n## Motivation (Confidence: 80%)\n\nmotivation text.\n\n## Core idea (Confidence: 85%)\n\ncore text.\n\n## Distinguishing factor (Confidence: 80%)\n\ndiff text.\n\n## Evaluation and conclusions (Confidence: 78%)\n\n**Result.** result text. My read: read.\n\n## In case you missed it (Confidence: 75%)\n\n- [pos] a positive entry.\n- [neg] a negative entry.\n\n## Cautious judgement (Confidence: 70%)\n\n| Question | Answer | Confidence |\n| --- | --- | --- |\n| Fair comparison to external baselines? | yes | 80% |\n| Invents its own FoM? | no | 90% |\n| Rewrite of an existing idea? | no | 80% |\n| Reliable enough to reuse? | yes | 85% |\n\n## Sources and limits (Confidence: 85%)\n\nread the source.\n`;

const source = {
  site: "arxiv",
  ids: { arxiv: "2610.17099", doi: null },
  key: "arxiv:2610.17099",
  title: "Sample Paper",
  authors: ["Jane Doe", "John Smith"],
  venue: "arXiv:2610.17099",
  sourceUrl: "https://arxiv.org/html/2610.17099",
  baseUrl: "https://arxiv.org/html/2610.17099",
  whatRead: "arXiv HTML full text",
  paperText: "# Sample Paper\n\nSome body text.",
  figures: [
    { n: "1", dataA: "S2.F1", caption: "Fig. 1: diagram", url: "https://arxiv.org/html/fig1.png", svg: "" },
    { n: "2", dataA: "S3.F2", caption: "Fig. 2: hardware", url: "", svg: "<svg>...</svg>" },
  ],
  warnings: [],
};

describe("pipeline — prompt / digest parsing", (t) => {
  test("buildPrompt carries figures from Source and never injects frontmatter keys", () => {
    const p = buildPrompt(source);
    assert.ok(p.includes("data-n=\"1\""), "figure data-n in prompt");
    assert.ok(p.includes("data-a=\"S2.F1\""), "figure data-a in prompt");
    assert.ok(p.includes("caption=\"Fig. 1: diagram\""), "caption in prompt");
    assert.ok(p.includes("url=\"https://arxiv.org/html/fig1.png\""), "url in prompt");
    assert.ok(p.includes("BASE URL (the page actually read): https://arxiv.org/html/2610.17099"), "baseUrl");
    assert.ok(p.includes("what was read: arXiv HTML full text"), "whatRead");
    // figures are listed, not injected as YAML frontmatter keys.
    assert.ok(!p.includes("figures:"), "no figures: frontmatter injection in prompt");
    assert.ok(!p.includes("baseUrl:"), "no baseUrl: frontmatter injection in prompt");
  });

  test("extractFinal takes the last <final> block", () => {
    assert.strictEqual(extractFinal("<final>  spaced  </final>"), "spaced");
    assert.strictEqual(extractFinal("<final>first</final> junk <final>second</final>"), "second");
    assert.strictEqual(extractFinal("<draft>x</draft>"), null);
  });

  test("extractDraft takes the last <draft> block", () => {
    assert.strictEqual(extractDraft("<draft>  spaced  </draft>"), "spaced");
    assert.strictEqual(extractDraft("<final>x</final>"), null);
  });

  test("parseDigest unwraps <final> else <draft> and parses sections", () => {
    const response = "<notes>ledger</notes><draft>" + FM + "</draft><check>Fixes to apply: 0</check>";
    const digest = parseDigest(response);
    assert.strictEqual(digest.meta.title, "Sample Paper");
    assert.deepStrictEqual(digest.meta.authors, ["Jane Doe", "John Smith"]);
    assert.strictEqual(digest.meta.id, "2610.17099");
    assert.strictEqual(digest.meta.overallConfidence, 80);
    assert.strictEqual(digest.sections.length, 8);
    assert.strictEqual(digest.sections[0].id, "bg");
    assert.strictEqual(digest.sections[0].title, "Specific background");
    assert.strictEqual(digest.sections[1].id, "mot");
    assert.strictEqual(digest.sections[0].confidence, 90);
    assert.deepStrictEqual(digest.sections[5].entries, [
      { text: "a positive entry.", tag: "pos" },
      { text: "a negative entry.", tag: "neg" },
    ]);
    assert.strictEqual(digest.sections[6].rows.length, 4);
    assert.strictEqual(digest.raw, response);
  });

  test("parseDigest falls back to <draft> when <final> is absent", () => {
    const response = "<notes>n</notes><draft>" + FM + "</draft><check>Fixes to apply: 0</check>";
    const digest = parseDigest(response);
    assert.strictEqual(digest.meta.title, "Sample Paper");
  });

  test("parseDigest throws on truncated response", () => {
    assert.throws(() => parseDigest("<notes>n</notes><draft>" + FM.slice(0, 20)), /no <final> or <draft>/);
  });

  test("filenameFor", () => {
    const digest = { meta: { title: "LocalTrain: Integer-Only Local Learning", authors: ["Shiqi Ding"], venue: "arXiv:2610.17099 [cs.AR]", id: "2610.17099", whatRead: "w", verdict: "v", overallConfidence: 80 }, sections: [] };
    const name = filenameFor(digest);
    assert.ok(name.startsWith("Shiqi_Ding-2026-arXiv-"), "filename: " + name);
  });
});

describe("pipeline — render sanitization", async (t) => {
  // Shim a minimal window so render.js (which reads window.location.href at
  // module load) can be imported in Node.
  globalThis.window = globalThis.window || { location: { href: "http://localhost/" } };
  const { renderContent, sanitizeHtml } = await import("../../web/js/pipeline/render.js");

  test("$$ display math and \\(...\\) inline math pass through unchanged", () => {
    const h = renderContent("$$\\begin{aligned}a&=b\\\\\\end{aligned}$$ and \\(x_i \\le y\\).");
    assert.ok(h.includes("\\["), "display math starts with \\\\["); 
    assert.ok(h.includes("\\begin{aligned}"), "aligned preserved");
    assert.ok(h.includes("\\\\"), "line breaks preserved");
    assert.ok(h.includes("\\(x_i \\le y\\)"), "inline math preserved");
  });

  test("single $ is literal (currency-safe): $5 and $6", () => {
    const h = renderContent("Price $5 and $6 total.");
    assert.ok(h.includes("$5 and $6"), "single dollars left literal");
    assert.ok(!h.includes("\\("), "single $ not treated as math");
  });

  test("< and & inside math are escaped for HTML", () => {
    const h = renderContent("\\(a < b \\& c\\)");
    assert.ok(h.includes("\\(a &lt; b \\&amp; c\\)"), "math escaped");
  });

  test("sanitizeHtml strips <script> and onerror", () => {
    const h = sanitizeHtml('<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    assert.ok(!h.includes("<script>"), "script stripped");
    assert.ok(!h.includes("onerror"), "onerror stripped");
  });

  test("sanitizeHtml neutralizes SVG <script>, foreignObject and onload", () => {
    const svg = '<svg onload="alert(1)"><foreignObject><div>x</div></foreignObject><script>alert(2)</script><rect/></svg>';
    const h = sanitizeHtml(svg, { svg: true });
    assert.ok(!h.includes("onload"), "onload stripped");
    assert.ok(!h.includes("<script>"), "svg script stripped");
    assert.ok(!h.includes("foreignObject"), "foreignObject stripped");
    assert.ok(h.includes("<rect"), "rect retained");
  });

  test("sanitizeHtml allows figure[data-n][data-a] and math tags", () => {
    const h = sanitizeHtml('<figure data-n="1" data-a="S2.F1"><figcaption>Cap.</figcaption></figure>\\(E=mc^2\\)');
    assert.ok(h.includes('data-n="1"'), "data-n kept");
    assert.ok(h.includes('data-a="S2.F1"'), "data-a kept");
    assert.ok(h.includes("<figcaption"), "figcaption kept");
  });

  test("sanitizeHtml preserves $& in SVG text (no $ substitution)", () => {
    const svg = '<svg><text x="10" y="10">cost $& and $$</text></svg>';
    const h = sanitizeHtml(svg, { svg: true });
    assert.ok(h.includes("$&"), "dollar-ampersand survives");
    assert.ok(h.includes("$$"), "double dollar survives");
  });
});
