/**
 * Agent orchestration: build the master prompt, call the OpenRouter LLM,
 * parse the Markdown response into a digest object.
 *
 * The LLM client (src/llm.js) follows the reference Python `LLM` class:
 * OpenRouter API key from OPENROUTER_API_KEY or ~/.paper_digest_key,
 * models tried in order with retries and a per-run cap.
 */

import { buildMasterPrompt, extractFinal, extractDraft } from "./prompt.js";
import { LLM, loadConfig, extractMarkdown } from "./llm.js";

const SYSTEM = "You are a careful, skeptical research-paper reader. Output only valid Markdown with YAML frontmatter.";

const SECTION_IDS = {
  "motivation": "mot",
  "core idea": "core",
  "distinguishing factor": "diff",
  "evaluation and conclusions": "eval",
  "in case you missed it": "icymi",
  "cautious judgement": "judge",
  "sources and limits": "src",
};

export { splitSections, parseIcymi, parseJudge, loadConfig };

/**
 * Build a pre-configured OpenRouter LLM client.
 *
 * @param {object} [cfg] - LLM config (models, temperature, max_tokens, ...)
 * @returns {LLM}
 */
export function createClient(cfg) {
  return new LLM(cfg);
}

/**
 * Split a markdown body into sections keyed by `## ` headers.
 *
 * @param {string} body - markdown body text
 * @returns {Array<{id:string, title:string, content:string, raw:string}>}
 */
function splitSections(body) {
  const lines = body.split("\n");
  const sections = [];
  let current = null;
  let buf = [];

  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      if (current) {
        current.content = buf.join("\n").trim();
        sections.push(current);
      }
      const rawTitle = h[1].trim();
      // A section header may carry an inline confidence, e.g.
      // "## Motivation (Confidence: 90%)". Strip it so the clean title
      // matches the known section ids, and carry the confidence through.
      const confM = /\(\s*[Cc]onfidence:\s*(\d+(?:\.\d+)?)\s*%?\s*\)\s*$/i.exec(rawTitle);
      let title = rawTitle;
      let confidence = null;
      if (confM) {
        confidence = Number(confM[1]);
        title = rawTitle.slice(0, confM.index).trimEnd();
      }
      const id = SECTION_IDS[title.toLowerCase()] || slug(title);
      current = { id, title, content: "", raw: "", confidence };
      buf = [];
    } else {
      if (current) buf.push(line);
    }
  }
  if (current) {
    current.content = buf.join("\n").trim();
    sections.push(current);
  }
  return sections;
}

function slug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 20);
}

/**
 * Parse icymi tag list entries from markdown.
 *
 * Entries look like: - [pos] text
 * @param {string} content - markdown content of the icymi section
 * @returns {Array<{text:string, tag:string}>}
 */
function parseIcymi(content) {
  const entries = [];
  // Entries look like: "- [pos] text" or "* `[neu]` text" (backticks around
  // the tag are optional).
  const re = /^[*-]\s*`?\[(pos|neg|neu)\]`?\s*(.*)$/;
  for (const line of content.split("\n")) {
    const m = re.exec(line);
    if (m) {
      entries.push({ text: m[2].trim(), tag: m[1] });
    }
  }
  return entries;
}

/**
 * Parse judge table rows from markdown.
 *
 * Rows are markdown table rows: | Question | Answer | Confidence |
 * @param {string} content - markdown content of the judge section
 * @returns {Array<{question:string, answer:string, conf:number}>}
 */
function parseJudge(content) {
  const rows = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const m = /^\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|?\s*$/.exec(line);
    if (!m) continue;
    const q = m[1].trim();
    const a = m[2].trim();
    const c = m[3].trim();
    // Skip header and separator rows
    if (q.toLowerCase() === "question") continue;
    if (/^[-:\s|]+$/.test(q)) continue;
    const conf = Number(c.replace("%", "").trim()) || 0;
    rows.push({ question: q, answer: a, conf });
  }
  return rows;
}

/**
 * Run the agent on a resolved source. Returns the parsed digest object.
 *
 * @param {object} source - output of fetch.resolve()
 * @param {object} [opts]
 * @param {LLM} [opts.client] - pre-built LLM client
 * @param {object} [opts.cfg] - LLM config (passed to LLM constructor)
 * @returns {Promise<object>}
 */
export async function digestSource(source, { client, cfg } = {}) {
  const llm = client || createClient(cfg);
  const user = buildMasterPrompt({
    paperText: source.paperText || "",
    figures: source.figures || [],
    baseUrl: source.baseUrl || "",
    whatRead: source.whatRead || "unknown",
  });
  const response = await llm.chat(SYSTEM, user);
  let finalMd = extractFinal(response);
  if (finalMd === null) {
    // The check asked for fixes but no <final> was emitted: warn and render
    // the draft unchanged. Never block or re-prompt (single request rule).
    const fixM = /Fixes to apply:\s*(\d+)/.exec(response);
    if (fixM && Number(fixM[1]) > 0) {
      console.warn(
        `[paper-digest] Fixes to apply: ${fixM[1]} reported in <check> but no <final> block was returned; rendering the draft unchanged (single request rule: no re-prompt)`,
      );
    }
    // A clean check ("Fixes to apply: 0") means the agent correctly omitted
    // <final>; the draft IS the document. Fall back to it before failing.
    finalMd = extractDraft(response);
    if (finalMd === null) {
      throw new Error(
        "agent response contains no <final> or <draft> block (the response may have been truncated)",
      );
    }
  }
  const parsed = extractMarkdown(finalMd);

  const sections = splitSections(parsed.body);

  // Attach section-specific parsed data
  for (const s of sections) {
    if (s.id === "icymi") {
      s.entries = parseIcymi(s.content);
    }
    if (s.id === "judge") {
      s.rows = parseJudge(s.content);
    }
  }

  const digest = {
    ...parsed.metadata,
    sections,
    _salvaged: parsed._salvaged,
    // The full raw agent response (all blocks: <notes>, <draft>, <check>
    // and possibly <final>), kept alongside the rendered digest so failures
    // can be diagnosed without re-running the model (I7).
    raw: response,
  };

  // Carry figure metadata through so standalone template rendering can
  // resolve image URLs (figures are parsed at fetch time, not by the agent).
  digest.figures = source.figures || [];
  digest.baseUrl = source.baseUrl || "";

  return digest;
}
