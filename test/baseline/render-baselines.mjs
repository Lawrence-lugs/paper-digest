/**
 * Render baseline HTML for all fixtures and save to test/baseline/
 *
 * Usage: node test/baseline/render-baselines.mjs
 */

import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

// Setup jsdom BEFORE importing render.js (which creates DOMPurify at module load)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

// Mock fetch to return the template
const templatePath = fileURLToPath(new URL("../../web/assets/template.html", import.meta.url));
const template = readFileSync(templatePath, "utf8");
globalThis.fetch = async () => new Response(template);

// NOW import renderDigest (after jsdom is set up)
const { renderDigest } = await import("../../web/js/pipeline/render.js");

import { fixtures } from "./fixtures.mjs";

const BASELINE_DIR = fileURLToPath(new URL(".", import.meta.url));

async function renderAllBaselines() {
  console.log(`Rendering ${fixtures.length} baseline fixtures...\n`);

  for (const fixture of fixtures) {
    console.log(`  Rendering: ${fixture.name}`);
    try {
      const html = await renderDigest(fixture.digest, fixture.ctx);

      const outputPath = join(BASELINE_DIR, `${fixture.name}.html`);
      writeFileSync(outputPath, html, "utf8");
      console.log(`    ✓ Saved to ${fixture.name}.html (${html.length} chars)`);
    } catch (err) {
      console.error(`    ✗ Failed: ${err.message}`);
      throw err;
    }
  }

  console.log("\n✓ All baselines rendered successfully.");
}

renderAllBaselines().catch((err) => {
  console.error("Failed to render baselines:", err);
  process.exit(1);
});