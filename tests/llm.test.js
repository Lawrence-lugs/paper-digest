/**
 * Tests for src/llm.js: extractMarkdown (frontmatter + body parsing).
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractMarkdown } from "../src/llm.js";

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures");
const handwritten = readFileSync(join(FIXTURES, "handwritten.md"), "utf8");

test("llm: extractMarkdown parses the handwritten fixture frontmatter and body", () => {
  const { metadata, body, raw, _salvaged } = extractMarkdown(handwritten);

  assert.strictEqual(_salvaged, false, "clean fixture is not salvaged");
  assert.strictEqual(metadata.title, "A Sample Paper for Digest Rendering Tests");
  assert.deepStrictEqual(metadata.authors, ["Jane Doe", "John Smith"]);
  assert.strictEqual(metadata.venue, "arXiv:2601.00001v1 [cs.AR]");
  assert.strictEqual(metadata.id, "2601.00001");
  assert.strictEqual(metadata.overallConfidence, "80");
  // frontmatter keys are in the documented order
  assert.deepStrictEqual(
    Object.keys(metadata),
    ["title", "authors", "venue", "id", "whatRead", "verdict", "overallConfidence"],
  );
  assert.ok(body.includes("## Motivation (Confidence: 85%)"), "body begins with sections");
  assert.strictEqual(raw, handwritten.trim(), "raw is the normalised document");
});

test("llm: frontmatter scalar values with commas round-trip verbatim", () => {
  const md =
    "---\ntitle: T\nauthors: A, B\nvenue: v\nid: 1\n" +
    "whatRead: no code, no supplementary material\n" +
    "verdict: X, and Y, but not Z.\noverallConfidence: 80\n---\n\n" +
    "## Motivation (Confidence: 80%)\n\nmot body.\n";
  const { metadata } = extractMarkdown(md);

  assert.strictEqual(typeof metadata.verdict, "string", "verdict stays a scalar");
  assert.strictEqual(metadata.verdict, "X, and Y, but not Z.", "verdict round-trips verbatim");
  assert.strictEqual(
    metadata.whatRead,
    "no code, no supplementary material",
    "whatRead round-trips verbatim",
  );
});

test("llm: authors split on comma and re-join with \", \"", () => {
  const md =
    "---\ntitle: T\nauthors: Jane Doe, John Smith\n---\n\n" +
    "## Motivation (Confidence: 80%)\n\nx.\n";
  const { metadata } = extractMarkdown(md);

  assert.deepStrictEqual(metadata.authors, ["Jane Doe", "John Smith"]);
  assert.strictEqual(metadata.authors.join(", "), "Jane Doe, John Smith");
});
