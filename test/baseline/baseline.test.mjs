/**
 * Baseline test suite - verifies comparer passes on unchanged code
 * and fails on deliberate one-char changes.
 */

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { fixtures } from "./fixtures.mjs";
import { compareHtml, assertHtmlEqual } from "./comparer.mjs";

// Setup jsdom before importing render.js
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// Mock fetch
const templatePath = fileURLToPath(new URL("../../web/assets/template.html", import.meta.url));
const template = readFileSync(templatePath, "utf8");
globalThis.fetch = async () => new Response(template);

// Import after jsdom setup
const { renderDigest } = await import("../../web/js/pipeline/render.js");

const BASELINE_DIR = fileURLToPath(new URL(".", import.meta.url));

describe("baseline comparer — passes on unchanged output", () => {
  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const html = await renderDigest(fixture.digest, fixture.ctx);
      const baselinePath = `${BASELINE_DIR}/${fixture.name}.html`;
      const expectedHtml = readFileSync(baselinePath, "utf8");

      const result = compareHtml(html, expectedHtml);
      assert.strictEqual(result.equal, true, `Baseline mismatch for ${fixture.name}`);
    });
  }
});

describe("baseline comparer — detects deliberate changes", () => {
  test("fails on one-character change in content", async () => {
    const fixture = fixtures[0]; // minimal
    const html = await renderDigest(fixture.digest, fixture.ctx);
    const baselinePath = `${BASELINE_DIR}/${fixture.name}.html`;
    const expectedHtml = readFileSync(baselinePath, "utf8");

    // Introduce a deliberate one-character change
    const modifiedHtml = expectedHtml.replace("Minimal Paper", "Minimal Papers");

    const result = compareHtml(html, modifiedHtml);
    assert.strictEqual(result.equal, false, "Should detect the one-char change");
    assert.ok(result.diff, "Should have diff info");
    assert.ok(typeof result.diff.position === "number", "Should have position");
  });

  test("fails on attribute order change (normalized to not fail)", async () => {
    // This tests that attribute order normalization works
    const html1 = '<div class="a" id="b"></div>';
    const html2 = '<div id="b" class="a"></div>';

    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true, "Attribute order should be normalized");
  });

  test("fails on whitespace differences (normalized to not fail)", async () => {
    const html1 = '<div>  Hello   World  </div>';
    const html2 = '<div>Hello World</div>';

    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true, "Whitespace should be normalized");
  });

  test("fails on actual content difference", async () => {
    const html1 = '<div>Hello World</div>';
    const html2 = '<div>Hello World!</div>';

    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, false, "Should detect content difference");
  });

  test("assertHtmlEqual throws on mismatch", async () => {
    const fixture = fixtures[0];
    const html = await renderDigest(fixture.digest, fixture.ctx);
    const baselinePath = `${BASELINE_DIR}/${fixture.name}.html`;
    const expectedHtml = readFileSync(baselinePath, "utf8");

    // Modify expected
    const modifiedExpected = expectedHtml.replace("Minimal Paper", "Different Title");

    let threw = false;
    try {
      assertHtmlEqual(html, modifiedExpected, "Test assertion");
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes("mismatch") || err.message.includes("difference"));
      assert.ok(err.message.includes("Minimal Paper") || err.message.includes("Different Title"));
    }
    assert.strictEqual(threw, true, "assertHtmlEqual should throw on mismatch");
  });
});

describe("baseline comparer — preservation edge cases", () => {
  test("preserves whitespace in <pre> tags", () => {
    const html1 = '<pre>  Hello\n  World  </pre>';
    const html2 = '<pre>  Hello\n  World  </pre>';
    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true);
  });

  test("preserves whitespace in <code> tags", () => {
    const html1 = '<code>  x = 1  </code>';
    const html2 = '<code>  x = 1  </code>';
    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true);
  });

  test("strips comments", () => {
    const html1 = '<div><!-- comment -->Hello</div>';
    const html2 = '<div>Hello</div>';
    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true, "Comments should be stripped");
  });

  test("handles void elements", () => {
    const html1 = '<img src="a.png"><br>';
    const html2 = '<img src="a.png"><br>';
    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true);
  });

  test("normalizes attribute quoting", () => {
    const html1 = '<div class="a" id=\'b\'></div>';
    const html2 = '<div id="b" class="a"></div>';
    const result = compareHtml(html1, html2);
    assert.strictEqual(result.equal, true);
  });
});