/**
 * Tests for src/digest.js (digestSource) and src/prompt.js (extractFinal /
 * extractDraft / extractNotes).
 *
 * Output contract (TASK_PIPELINE.md I7):
 *  - digestSource falls back to <draft> when <final> is null
 *  - the full raw response is stored alongside the parsed digest
 *  - a warning is logged when Fixes to apply: N > 0 and there is no <final>
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { extractFinal, extractDraft, extractNotes } from "../src/prompt.js";
import { digestSource } from "../src/digest.js";

function sectionDoc(title, motivationLine) {
  return (
    "---\n" +
    `title: ${title}\n` +
    "authors: A\nvenue: v\nid: 1\nwhatRead: w\nverdict: v\noverallConfidence: 80\n" +
    "---\n\n" +
    `## Motivation (Confidence: 80%)\n${motivationLine}\n\n` +
    "## Core idea (Confidence: 80%)\ncore.\n\n" +
    "## Distinguishing factor (Confidence: 80%)\ndiff.\n\n" +
    "## Evaluation and conclusions (Confidence: 80%)\n**Result.** r. My read: m.\n\n" +
    "## In case you missed it (Confidence: 80%)\n- [pos] e.\n\n" +
    "## Cautious judgement (Confidence: 80%)\n" +
    "| Question | Answer | Confidence |\n" +
    "| --- | --- | --- |\n" +
    "| Fair comparison to external baselines? | y | 80% |\n" +
    "| Invents its own FoM? | n | 80% |\n" +
    "| Rewrite of an existing idea? | n | 80% |\n" +
    "| Reliable enough to reuse? | y | 80% |\n\n" +
    "## Sources and limits (Confidence: 80%)\ns.\n"
  );
}

test("prompt: extractFinal returns null when there is no <final> block", () => {
  assert.strictEqual(extractFinal(null), null);
  assert.strictEqual(extractFinal(undefined), null);
  assert.strictEqual(extractFinal("no blocks here"), null);
  assert.strictEqual(extractFinal("<draft>x</draft>"), null);
});

test("prompt: extractFinal takes the last complete <final> match and trims it", () => {
  assert.strictEqual(extractFinal("<final>  spaced  </final>"), "spaced");
  assert.strictEqual(
    extractFinal("<final>first</final> junk <final>second</final>"),
    "second",
  );
});

test("prompt: extractDraft returns null when there is no <draft> block", () => {
  assert.strictEqual(extractDraft(null), null);
  assert.strictEqual(extractDraft("<final>x</final>"), null);
});

test("prompt: extractDraft takes the last complete <draft> match and trims it", () => {
  assert.strictEqual(extractDraft("<draft>  spaced  </draft>"), "spaced");
  assert.strictEqual(
    extractDraft("<draft>first</draft> junk <draft>second</draft>"),
    "second",
  );
});

test("prompt: extractNotes returns null when absent", () => {
  assert.strictEqual(extractNotes(null), null);
  assert.strictEqual(extractNotes("nothing"), null);
  assert.strictEqual(
    extractNotes("<notes>ledger</notes>"),
    "ledger",
  );
});

const SOURCE = {
  paperText: "some paper text",
  figures: [],
  baseUrl: "https://arxiv.org/html/2610.17099v1",
  whatRead: "Full text via arXiv HTML",
};

function clientFor(content) {
  return { chat: async () => content };
}

test("digestSource: falls back to <draft> when <final> is absent", async () => {
  const response =
    "<notes>\nledger\n</notes>\n<draft>\n" +
    sectionDoc("Draft Title", "DRAFT-ONLY") +
    "</draft>\n<check>\nFixes to apply: 0\n</check>";
  const digest = await digestSource(SOURCE, { client: clientFor(response) });

  assert.strictEqual(digest.title, "Draft Title");
  assert.strictEqual(digest.sections.length, 7);
  assert.ok(digest.sections[0].content.includes("DRAFT-ONLY"));
  assert.strictEqual(
    digest.sections.map((s) => s.id).join(","),
    "mot,core,diff,eval,icymi,judge,src",
  );
});

test("digestSource: uses <final> when the check applied fixes", async () => {
  const response =
    "<notes>\nledger\n</notes>\n<draft>\n" +
    sectionDoc("Draft Title", "DRAFT-ONLY") +
    "</draft>\n<check>\nFixes to apply: 1\n</check>\n<final>\n" +
    sectionDoc("Final Title", "FINAL-ONLY") +
    "</final>";
  const digest = await digestSource(SOURCE, { client: clientFor(response) });

  assert.strictEqual(digest.title, "Final Title");
  assert.strictEqual(digest.sections.length, 7);
  assert.ok(digest.sections[0].content.includes("FINAL-ONLY"));
  assert.ok(!digest.sections[0].content.includes("DRAFT-ONLY"));
});

test("digestSource: stores the full raw response (all blocks)", async () => {
  const response =
    "<notes>\nledger\n</notes>\n<draft>\n" +
    sectionDoc("Draft Title", "DRAFT-ONLY") +
    "</draft>\n<check>\nFixes to apply: 0\n</check>";
  const digest = await digestSource(SOURCE, { client: clientFor(response) });

  assert.ok(digest.raw.includes("<notes>"), "raw stores <notes>");
  assert.ok(digest.raw.includes("<draft>"), "raw stores <draft>");
  assert.ok(digest.raw.includes("<check>"), "raw stores <check>");
});

test("digestSource: warns when Fixes to apply: N > 0 but no <final>", async () => {
  const response =
    "<draft>\n" + sectionDoc("Draft Title", "DRAFT-ONLY") + "</draft>\n<check>\nFixes to apply: 1\n</check>";
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    const digest = await digestSource(SOURCE, { client: clientFor(response) });
    // falling back to the draft must not block rendering
    assert.strictEqual(digest.title, "Draft Title");
  } finally {
    console.warn = origWarn;
  }
  assert.ok(
    warns.some((w) => /Fixes to apply/.test(w)),
    "expected a warning about fixes without a <final>",
  );
});

test("digestSource: a truncated response with no complete block throws", async () => {
  const response = "<draft>\n---\ntitle: T\nverdict: v\noverallConfidence: 80\n"; // never closed
  await assert.rejects(
    digestSource(SOURCE, { client: clientFor(response) }),
    /no <final> or <draft> block/,
  );
});
