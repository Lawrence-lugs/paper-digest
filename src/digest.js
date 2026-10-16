/**
 * Agent orchestration: build the master prompt, call the OpenRouter LLM,
 * parse the Markdown response into a digest object.
 *
 * The LLM client (src/llm.js) follows the reference Python `LLM` class:
 * OpenRouter API key from OPENROUTER_API_KEY or ~/.paper_digest_key,
 * models tried in order with retries and a per-run cap.
 */

import { buildMasterPrompt } from "./prompt.js";
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

export { splitSections, parseIcymi, parseJudge, parseCitations, loadConfig };

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
      const title = h[1].trim();
      const id = SECTION_IDS[title.toLowerCase()] || slug(title);
      current = { id, title, content: "", raw: "" };
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
  const re = /^-\s*\[(pos|neg|neu)\]\s*(.*)$/im;
  let m;
  const text = content;
  let last = 0;
  // Find all - [tag] lines
  const lines = text.split("\n");
  for (const line of lines) {
    const m2 = /^-\s*\[(pos|neg|neu)\]\s*(.*)$/.exec(line);
    if (m2) {
      entries.push({ text: m2[2].trim(), tag: m2[1] });
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
 * Parse citations from the src section content.
 * One citation per line, formatted as: "exact title" author year
 * @param {string} content - markdown content of the src section
 * @returns {string[]}
 */
function parseCitations(content) {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .filter((l) => !l.startsWith("- [") && !l.startsWith("|"));
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
  const md = await llm.chat(SYSTEM, user);
  const parsed = extractMarkdown(md);

  const sections = splitSections(parsed.body);

  // Attach section-specific parsed data
  for (const s of sections) {
    if (s.id === "icymi") {
      s.entries = parseIcymi(s.content);
    }
    if (s.id === "judge") {
      s.rows = parseJudge(s.content);
    }
    if (s.id === "src") {
      s.citations = parseCitations(s.content);
    }
  }

  const digest = {
    ...parsed.metadata,
    sections,
    _salvaged: parsed._salvaged,
    raw: parsed.raw,
  };

  // Carry figure metadata through so standalone template rendering can
  // resolve image URLs (figures are parsed at fetch time, not by the agent).
  digest.figures = source.figures || [];
  digest.baseUrl = source.baseUrl || "";

  return digest;
}
