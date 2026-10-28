import "./shim.mjs";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const template = readFileSync(fileURLToPath(new URL("../../web/assets/template.html", import.meta.url)), "utf8");
globalThis.fetch = async () => new Response(template);

test("muted header line links to the original source URL (any site, no arxiv regex)", async () => {
  const { renderDigest } = await import("../../web/js/pipeline/render.js");
  const html = await renderDigest({
    meta: {
      title: "T", authors: ["A"], venue: "IEEE", id: "10.1109/xyz", whatRead: "w", verdict: "ok", overallConfidence: 50,
    },
    sections: [],
  }, { baseUrl: "https://ieeexplore.ieee.org/document/12345" });
  // New scholarly-reader header: kicker (venue·id·what-read) wrapped in sr-kicker-link
  // Uses actual middot character (·) not entity
  assert.ok(html.includes('<a class="sr-kicker-link" href="https://ieeexplore.ieee.org/document/12345" style="color: inherit; text-decoration: underline; cursor: pointer;"><p class="sr-kicker">IEEE · 10.1109/xyz · read: w</p></a>'), "header wrapped in source link");
  assert.ok(!html.includes("{{SOURCE_OPEN}}"), "open placeholder replaced");
  assert.ok(!html.includes("{{SOURCE_CLOSE}}"), "close placeholder replaced");
});

test("arXiv id with junk prefix/quotes is NOT matched by regex - uses source URL instead", async () => {
  const { renderDigest } = await import("../../web/js/pipeline/render.js");
  const html = await renderDigest({
    meta: {
      title: "T", authors: ["A"], venue: '"arXiv preprint, version v2"', id: '"arXiv 2607.05475"', whatRead: '"read text"', verdict: "ok", overallConfidence: 80,
    },
    sections: [],
  }, { baseUrl: "https://arxiv.org/html/2607.05475v2" });
  assert.ok(html.includes('<a class="sr-kicker-link" href="https://arxiv.org/html/2607.05475v2"'), "links to source URL even when id looks non-standard");
  assert.ok(!html.includes('href="https://arxiv.org/html/2607.05475"'), "does not derive its own arxiv URL from id");
});

test("no source URL leaves muted header line as a plain paragraph", async () => {
  const { renderDigest } = await import("../../web/js/pipeline/render.js");
  const html = await renderDigest({
    meta: { title: "T2", authors: [], venue: "Nature", id: "10.1038/xyz", whatRead: "w", verdict: "ok", overallConfidence: 50 },
    sections: [],
  }, { baseUrl: "" });
  // Without baseUrl, kicker is not wrapped in a link
  // Uses actual middot character (·) not entity
  assert.ok(html.includes('<p class="sr-kicker">Nature · 10.1038/xyz · read: w</p>'), "plain paragraph when no source URL");
  assert.ok(!html.includes('<a class="sr-kicker-link"'), "no link when no source URL");
  assert.ok(!html.includes("{{SOURCE_OPEN}}"), "open placeholder replaced");
  assert.ok(!html.includes("{{SOURCE_CLOSE}}"), "close placeholder replaced");
});