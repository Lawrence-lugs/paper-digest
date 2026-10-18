/**
 * End-to-end pipeline test with all HTTP spoofed via nock: no network.
 *
 * Spoofs an arXiv HTML fetch and an OpenRouter chat/completions response,
 * then runs resolve -> digestSource -> renderString.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nock from "nock";
import { resolve } from "../src/fetch.js";
import { digestSource, createClient } from "../src/digest.js";
import { renderString } from "../src/template.js";

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures");

function read(name) {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function sectionDoc(title, motivationLine) {
  return (
    "---\n" +
    `title: ${title}\n` +
    "authors: Tester One, Tester Two\nvenue: arXiv:2610.17099v1 [cs.AR]\n" +
    "id: 2610.17099\nwhatRead: Full text via arXiv HTML (main body and references; no code, no supplementary material)\n" +
    "verdict: The end-to-end pipeline works, with commas, in the verdict.\noverallConfidence: 80\n" +
    "---\n\n" +
    `## Motivation (Confidence: 80%)\n${motivationLine}\n\n` +
    "## Core idea (Confidence: 80%)\nCore idea text.\n\n" +
    "## Distinguishing factor (Confidence: 80%)\nDiff text.\n\n" +
    "## Evaluation and conclusions (Confidence: 80%)\n" +
    "**Headline result.** Result text. My read: read text.\n\n" +
    "## In case you missed it (Confidence: 80%)\n- [pos] something positive.\n\n" +
    "## Cautious judgement (Confidence: 80%)\n" +
    "| Question | Answer | Confidence |\n" +
    "| --- | --- | --- |\n" +
    "| Fair comparison to external baselines? | yes | 80% |\n" +
    "| Invents its own FoM? | no | 80% |\n" +
    "| Rewrite of an existing idea? | no | 80% |\n" +
    "| Reliable enough to reuse? | yes | 80% |\n\n" +
    "## Sources and limits (Confidence: 80%)\nI read the full text.\n"
  );
}

test(
  "pipeline: nocked arXiv fetch + nocked OpenRouter digest -> rendered HTML, no network",
  async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    nock.cleanAll();
    nock.disableNetConnect();

    try {
      const arxivHtml = read("arxiv-sample.html");
      const arxiv = nock("https://arxiv.org")
        .get("/html/2610.17099")
        .reply(200, arxivHtml);

      const response =
        "<notes>\nEvidence ledger line.\n</notes>\n<draft>\n" +
        sectionDoc("Pipeline Test Digest", "Pipeline motivation.") +
        "</draft>\n<check>\nFixes to apply: 0\n</check>";
      let openRouterBody = null;
      const openRouter = nock("https://openrouter.ai")
        .post("/api/v1/chat/completions", (body) => {
          openRouterBody = body;
          return true;
        })
        .reply(200, {
          id: "gen-pipeline-test",
          model: "mock-model",
          choices: [{ message: { content: response } }],
        });

      // 1. fetch stage: arXiv HTML (spoofed)
      const source = await resolve("2610.17099");
      assert.strictEqual(source.kind, "arxiv");
      assert.strictEqual(source.value, "2610.17099");
      assert.strictEqual(source.baseUrl, "https://arxiv.org/html/2610.17099");
      assert.ok(source.html.includes("Sample Paper on Local Learning"), "fixture HTML fetched");
      assert.ok(Array.isArray(source.figures) && source.figures.length >= 2, "figures parsed");

      // 2. agent stage: OpenRouter (spoofed), draft fallback since the check is clean
      const digest = await digestSource(
        { ...source, paperText: source.html },
        { client: createClient({ model: "mock-model" }) },
      );
      assert.ok(openRouter.isDone(), "OpenRouter interceptor consumed");
      assert.ok(openRouterBody.model && typeof openRouterBody.model === "string", "request forwarded to a model: " + openRouterBody.model);
      assert.ok(arxiv.isDone(), "arXiv interceptor consumed");
      assert.strictEqual(digest.title, "Pipeline Test Digest");
      assert.deepStrictEqual(
        digest.sections.map((s) => s.id),
        ["mot", "core", "diff", "eval", "icymi", "judge", "src"],
      );
      // The full raw response (all blocks) is stored alongside the digest so
      // failures can be diagnosed. (I7: the contract wants all blocks here;
      // that storage is verified in tests/digest.test.js.)
      assert.ok(
        digest.raw.includes("## Motivation"),
        "raw response stored (draft document)",
      );

      // 3. render stage: self-contained HTML, no network
      const rendered = await renderString(digest, {
        figures: source.figures,
        baseUrl: source.baseUrl,
      });
      assert.ok(rendered.includes("Pipeline Test Digest"), "title in rendered HTML");
      assert.ok(rendered.includes('id="mot"'), "Motivation section rendered");
      assert.ok(rendered.includes('id="src"'), "Sources section rendered");
      assert.ok(
        rendered.includes('const BASE = "https://arxiv.org/html/2610.17099";'),
        "baseUrl flows into the page script",
      );
    } finally {
      nock.enableNetConnect();
      nock.cleanAll();
      delete process.env.OPENROUTER_API_KEY;
    }
  },
);
