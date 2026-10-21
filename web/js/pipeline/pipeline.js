/**
 * Agent B — pipeline.
 *
 * buildPrompt / runDigest / parseDigest / renderDigest / filenameFor and the
 * output helpers (open in a new tab, download .html, copy HTML).
 *
 * The prompt contract is unchanged: one request, <notes>/<draft>/<check>/
 * <final>, parser takes <final> else <draft>. Figures come from `Source`
 * (never injected into the AI's Markdown).
 */

import { renderDigest } from "./render.js";
import {
  LLMUnavailable,
  OpenRouterClient,
  OpenAICompatibleClient,
  LocalBackendClient,
} from "./llm.js";

const SYSTEM =
  "You are a careful, skeptical research-paper reader. Output only valid Markdown with YAML frontmatter.";

const SECTION_IDS = {
  "specific background": "bg",
  motivation: "mot",
  "core idea": "core",
  "distinguishing factor": "diff",
  "evaluation and conclusions": "eval",
  "in case you missed it": "icymi",
  "cautious judgement": "judge",
  "sources and limits": "src",
};

function slug(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 20);
}

/* ---------------------------------------------------------------- prompt */

function q(s) {
  return JSON.stringify(String(s));
}

/**
 * Build the master prompt from a `Source`. Figures come from Source (never
 * embedded in the AI's Markdown). Contract unchanged.
 */
export function buildPrompt(source) {
  const figureList = (source.figures || [])
    .map(
      (f, i) =>
        `    - index=${i + 1} data-n=${q(String(f.n != null ? f.n : i + 1))} data-a=${q(
          f.dataA,
        )} caption=${q(f.caption)} url=${q(f.url)}`
    )
    .join("\n") || "    (none)";

  return `You are a careful, skeptical research-paper reader. Write for a technical reader at graduate level in computer architecture and EDA: no simplifying, no padding, no restating the abstract. Every section should tell the reader something they could not get from the abstract alone. When the paper says something and you think otherwise, keep the two apart: what the paper reports versus "my read".

The digest exists so the reader can absorb a paper fast and know how far to trust it. Digests of different papers are compared side by side, so the structure is fixed.

READING BUDGET
A digest is a second-pass read, not a review. Read the paper once, carefully, then write. Do not go to a third pass unless explicitly asked.

Do not:
- inspect derivations or proofs;
- reformalize the paper's problem into equations it does not already contain;
- open, fetch, or search for any cited paper (including the authors' earlier version);
- check arithmetic, or cross-check numbers between tables, text, and figures.

Exception: cross-check a headline number (abstract, verdict, main results) only if something about it looks off; if confirming it is not trivial, say it looks suspicious and move on.

TRACEABILITY
Everything you write should be traceable to what the paper says or does on the page. A claim that needs outside work to establish is either stated as "not verified" or left out. Words that judge implementation quality or novelty ("unoptimized", "naive", "standard", "state of the art", "outperforms", "novel") need the paper's own wording or a named comparison behind them; otherwise drop the word. Do not attribute a difference in results to a cause (training recipe, implementation quality, data) unless the paper says so; if you suspect one, write it as "possibly" and say it is not verified.

SOURCE HANDLING
The source text below was machine-extracted from the paper's HTML. It may contain page chrome, garbled symbols, or math written twice. Ignore chrome. For math, use the clean LaTeX form and never copy garbled symbols. If garbling made part of the paper unreadable, say which part in "Sources and limits" and lower that section's confidence.

ABBREVIATIONS
Spell out an abbreviation the first time it appears, then never again. For example, TP (Tensor Parallelism).

SOURCE TEXT (what was read: ${source.whatRead}):
\`\`\`
${source.paperText}
\`\`\`

FIGURES (element ids recorded for the template):
${figureList}
BASE URL (the page actually read): ${source.baseUrl || ""}

OUTPUT CONTRACT
Your entire response consists of these blocks, in this order, and nothing else: no text before, between, or after them.

<notes>
EVIDENCE LEDGER. Plain text, at most 400 words. Do not write the document here. One line per fact you will rely on, in the form "[where in the source] fact or number | use: core / diff / eval / icymi / limit". Include: every number the Evaluation section will cite; every design choice you plan to list under "In case you missed it"; and, for every claim you will judge (baseline fairness, novelty, measurement boundary), the paper's own wording or the named comparison behind it. End with one line "SUSPECT:" naming any headline number that looks off, or "none".
</notes>
<draft>
A complete first version of the document, in the DOCUMENT FORMAT below, written from the ledger: every number in it appears in the ledger.
</draft>
<check>
The audit of the draft. Part 1, format: for each numbered rule in the HARD FORMAT RULES write one line: the rule number, PASS or FAIL, and short evidence. For each FAIL, add one line stating the exact fix.
Part 2, content: each as one line or a short list.
(C1) Name the three most load-bearing numbers or claims in Evaluation and conclusions, and for each give the ledger line and the source section it comes from, or write "not verified" and fix the draft.
(C2) For each "In case you missed it" entry, state which of the four tests in the SECTION GUIDE it passes and in a few words why it is not already covered elsewhere. Remove any that fail.
(C3) List every judging word from the TRACEABILITY paragraph that appears in the draft, with the paper's own wording that supports it, and list every place the draft attributes a result difference to a cause, with the paper's statement or "not stated". Remove or soften any without support.
(C4) State whether any statement in "My read" depends on a number or fact outside the source text; if so, mark it "not verified" or delete it.
(C5) List the eight section confidences and say why the spread is justified.
End with "Fixes to apply: N". Content fixes count as fixes.
</check>
<final>  (conditional -- write only when the check found fixes)
The document again, with every fix from the check applied. This block follows the DOCUMENT FORMAT exactly and contains only the document.
</final>

Write <final> ONLY when the check found fixes ("Fixes to apply: N" with N > 0). If the check reports "Fixes to apply: 0", do NOT write a <final> block: end the response right after </check>. The draft IS the document -- <final> would be identical to it, so writing it is unnecessary.

Each of <notes>, <draft> and <check> appears exactly once as an opening tag and once as a closing tag; <final> appears the same way only when the check found fixes, otherwise it is omitted entirely. Never write the strings <notes>, <draft>, <check>, or <final> inside any block's content. Write the notes first, then the draft, then the check, then the final (when written): do not claim a rule passes without citing evidence from the draft.

SECTION GUIDE (the eight sections, in this order)

Verdict (frontmatter). Two or three sentences: what the paper actually delivers, how far the evidence supports it, and where it is weakest. Specific enough that it could not describe a different paper.

Specific background. The concepts the paper itself stops to explain in its introduction (or in a preliminaries/background section, if it has one) because the reader needs them to follow the method or results. The paper's decision to explain a concept is what puts it here, so a concept qualifies if the paper defines it, motivates it, or illustrates it with an example. Explain each one using only what the paper says, in the order the reader needs them. One short paragraph or a few sentences per concept, starting with a bold term. Exclude: the problem statement and why it matters (Motivation), the proposed method (Core idea), and anything the paper assumes without explaining, even if you think a reader might not know it. If a later section of the digest would not need the concept, leave it out.

Motivation. The problem and why the authors say it matters. End with one sentence on whether the motivation is itself convincing.

Core idea. What the method is, in the order a reimplementer would need it. Include the key equations the paper already contains. Large papers can contain several core ideas; whether something is a core idea or an "In case you missed it" entry is a judgement call, so make it and stay consistent. Embed the framework figure if one exists.

Distinguishing factor. Compare against each family of prior work separately, one short paragraph per family, naming the earlier idea when the paper itself makes it obvious. Separate "new idea" from "new packaging of a known idea". If the paper extends the authors' own earlier version, add a short "vs. their earlier version" paragraph using only what the paper says changed; otherwise say the paper describes none.

Evaluation and conclusions. Pick the results that carry the paper's claims (usually 2 to 5, plus any one surprising result). Write one paragraph per result. Each paragraph starts with a bold label naming the result, then leads with the result and how it was evaluated (benchmark, baselines, metric, scale, seeds), then gives "My read:" in a sentence or two on what that result does and does not show. Mention rigor only where it changes how far that particular result can be trusted; do not audit every row. Close with a paragraph starting "**Conclusion.**" giving the paper's own conclusion and your read of whether the evidence supports it, separating what the evidence supports from what it only suggests.

In case you missed it. Written for someone building on or reimplementing the work. Concrete things the paper did or assumed that the other sections do not already cover. Three to six entries is typical. An empty section is better than a padded one.

Cautious judgement. Four rows, answers specific: name the baseline that is missing, the metric that is custom, the earlier work it echoes.

Sources and limits. One paragraph saying exactly what was read, what was not (appendix, code, supplementary, cited papers), and what could not be checked. State it once. Do not list citations.

DOCUMENT FORMAT
Produce a single Markdown document with YAML frontmatter for metadata and a markdown body for sections. No code fences, no prose before/after the frontmatter. No JSON. No string escaping needed: write plain Markdown.

---
title: Paper title
authors: Author1, Author2
venue: venue and id
id: arxiv id or similar
whatRead: exactly what was read
verdict: 2-3 sentence verdict
overallConfidence: NN
---

## Specific background (Confidence: NN%)
...
## Motivation (Confidence: NN%)
...
## Core idea (Confidence: NN%)
...
## Distinguishing factor (Confidence: NN%)
...
## Evaluation and conclusions (Confidence: NN%)
...
## In case you missed it (Confidence: NN%)
...
## Cautious judgement (Confidence: NN%)
...
## Sources and limits (Confidence: NN%)
...

HARD FORMAT RULES
1. Exactly one <notes>, one <draft> and one <check> block, in that order, plus one <final> only when the check found fixes.
2. Inside <final>, the first characters are "---" and the frontmatter closes with a second "---" line.
3. The frontmatter has exactly these keys in this order: title, authors, venue, id, whatRead, verdict, overallConfidence.
4. The body has exactly eight "## " headings, once each, in this order: Specific background, Motivation, Core idea, Distinguishing factor, Evaluation and conclusions, In case you missed it, Cautious judgement, Sources and limits.
5. Every heading ends with " (Confidence: NN%)".
6. The judgement table has a header, separator, and exactly four data rows with the four questions worded exactly as given.
7. Every "In case you missed it" entry starts with "- [pos] ", "- [neg] ", or "- [neu] ".
8. No code fences anywhere in <draft> or <final>.
9. Every $$ is closed by a matching $$, and every \\( is closed by a matching \\).
10. Every <figure> has a data-n in the figure list, a data-a equal to that figure's id, and a <figcaption>. No  tag. At most two figures, never one whose caption begins with "TABLE".
11. No JSON, no text before the frontmatter or after the last section; the block strings do not appear inside contents.
12. Evaluation and conclusions contains no table; 3 to 7 paragraphs, each begins with a bold label, every paragraph except the last contains "My read:", the last begins with "**Conclusion.**".
13. Sources and limits contains exactly one prose paragraph.
14. The eight section confidences contain at least three distinct values, none exceeds 90.
15. Every number cited in Evaluation and conclusions appears in the ledger.`;
}

/* ---------------------------------------------------------------- response parsing */

export function extractFinal(response) {
  const matches = [...String(response).matchAll(/<final>([\s\S]*?)<\/final>/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

export function extractDraft(response) {
  const matches = [...String(response).matchAll(/<draft>([\s\S]*?)<\/draft>/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

/** Extract a Markdown document with YAML frontmatter from model output. */
function extractMarkdown(content) {
  let text = String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  let salvaged = false;
  const fence =
    /```markdown\n([\s\S]*?)\n```/i.exec(text) ||
    /```\n([\s\S]*?)\n```/i.exec(text);
  if (fence) {
    text = fence[1].trim();
    salvaged = true;
  }
  const fmRe = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  let m = fmRe.exec(text);
  if (!m && text.startsWith("---\n")) {
    const sectionTitles = new Set([
      "specific background", "motivation", "core idea", "distinguishing factor",
      "evaluation and conclusions", "in case you missed it",
      "cautious judgement", "sources and limits",
    ]);
    const rest = text.slice(4);
    const lines = rest.split("\n");
    let splitIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const hm = /^##\s+(.+)$/.exec(lines[i]);
      if (!hm) continue;
      const t = hm[1].trim().replace(/\s*\([^)]*confidence[^)]*\)\s*$/i, "").trim().toLowerCase();
      if (sectionTitles.has(t)) {
        splitIdx = i;
        break;
      }
    }
    const fmLines = lines.slice(0, splitIdx).map((l) => l.replace(/^##\s+/, ""));
    m = [text, fmLines.join("\n"), lines.slice(splitIdx).join("\n")];
    salvaged = true;
  }
  if (!m) throw new Error("no parseable Markdown frontmatter in response");
  const fmText = m[1];
  const body = m[2];
  const metadata = {};
  for (const line of fmText.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (!key) continue;
    if ((val.startsWith("[") || val.startsWith("{")) && (val.endsWith("]") || val.endsWith("}"))) {
      try { val = JSON.parse(val); } catch (_) { /* keep string */ }
    } else if (key === "authors" && val.includes(",")) {
      val = val.split(",").map((s) => s.trim()).filter(Boolean);
    }
    metadata[key] = val;
  }
  return { _salvaged: salvaged, metadata, body, raw: text };
}

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

function parseIcymi(content) {
  const entries = [];
  const re = /^[*-]\s*`?\[(pos|neg|neu)\]`?\s*(.*)$/;
  for (const line of content.split("\n")) {
    const m = re.exec(line);
    if (m) entries.push({ text: m[2].trim(), tag: m[1] });
  }
  return entries;
}

function parseJudge(content) {
  const rows = [];
  for (const line of content.split("\n")) {
    const m = /^\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|?\s*$/.exec(line);
    if (!m) continue;
    const q = m[1].trim();
    if (q.toLowerCase() === "question") continue;
    if (/^[-:\s|]+$/.test(q)) continue;
    rows.push({
      question: q,
      answer: m[2].trim(),
      conf: Number(m[3].replace("%", "").trim()) || 0,
    });
  }
  return rows;
}

/**
 * Unwrap an agent response: <final> else <draft>. Salvage YAML frontmatter.
 * Returns a `Digest` (meta + sections + raw).
 */
export function parseDigest(text) {
  let finalMd = extractFinal(text);
  if (finalMd === null) {
    finalMd = extractDraft(text);
  }
  if (finalMd === null) {
    throw new Error("agent response contains no <final> or <draft> block");
  }
  const parsed = extractMarkdown(finalMd);
  const sections = splitSections(parsed.body);
  for (const s of sections) {
    if (s.id === "icymi") s.entries = parseIcymi(s.content);
    if (s.id === "judge") s.rows = parseJudge(s.content);
  }
  // Coerce numeric confidences (frontmatter/headings are strings).
  const meta = { ...parsed.metadata };
  if (meta.overallConfidence != null) meta.overallConfidence = Number(meta.overallConfidence) || 0;
  for (const s of sections) {
    if (s.confidence != null) s.confidence = Number(s.confidence) || null;
  }
  return { meta, sections, raw: text, _salvaged: parsed._salvaged };
}

/* ---------------------------------------------------------------- runDigest */

/**
 * Run the full digest pipeline: build the prompt, ask the LLM client,
 * unwrap the response, return {digest, raw}.
 */
export async function runDigest(source, client, cfg = {}) {
  const prompt = buildPrompt(source);
  const raw = await client.chat(SYSTEM, prompt);
  const digest = parseDigest(raw);
  return { digest, raw };
}

/* ---------------------------------------------------------------- filename */

function sanitize(field) {
  return String(field)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 _.\-]/g, "")
    .replace(/[_\s]+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
}

function shortenedTitle(title) {
  const stopwords = new Set([
    "a", "an", "the", "of", "for", "in", "on", "and", "with", "to", "via",
    "is", "are",
  ]);
  const beforeColon = String(title).split(":")[0];
  const words = beforeColon.toLowerCase().split(/\s+/).filter((w) => w && !stopwords.has(w));
  return words.slice(0, 4).join("_");
}

function extractYear(digest) {
  const m = String(digest.meta && digest.meta.venue || "").match(/\b(19|20)\d{2}\b/);
  if (m) return m[0];
  const idM = String(digest.meta && digest.meta.id || "").match(/(\d{2})\d{2}\.\d+/);
  if (idM) return `20${idM[1]}`;
  return String(new Date().getFullYear());
}

function venueAbbv(digest) {
  const v = String(digest.meta && digest.meta.venue || "");
  if (/arxiv/i.test(v)) return "arXiv";
  const known = ["neurips","icml","iclr","isscc","jssc","tcad","cvpr","iccv","eccv","acl","emnlp","naacl"];
  const low = v.toLowerCase();
  for (const k of known) if (low.includes(k)) return k.charAt(0).toUpperCase() + k.slice(1);
  const tok = v.split(/\s+/)[0];
  return sanitize(tok) || "arXiv";
}

/** Output filename: Author-year-journalabbv-shortenedtitle. */
export function filenameFor(digest) {
  const meta = digest.meta || {};
  const author = sanitize((meta.authors && meta.authors[0]) || "Unknown");
  const year = extractYear(digest);
  const journal = venueAbbv(digest);
  const title = shortenedTitle(meta.title || "");
  return `${author}-${year}-${journal}-${title}`.slice(0, 100);
}

/* ---------------------------------------------------------------- output helpers */

/** Open rendered HTML in a new tab (Blob URL). Call from a click handler. */
export function openInTab(html) {
  let tab;
  try {
    tab = window.open("about:blank", "_blank");
  } catch (_) {
    tab = null;
  }
  if (!tab) return { blocked: true };
  tab.opener = null;
  const blob = new Blob([html], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  // NOTE: revoking after navigation would break the page; the Blob URL is
  // owned by the new tab until it navigates away. For tab-based delivery we
  // keep it alive (the tab holds a reference via its location).
  tab.location = blobUrl;
  return { blocked: false, tab, blobUrl };
}

/** Download rendered HTML as a file. */
export function downloadHtml(html, filename) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy rendered HTML to the clipboard. */
export async function copyHtml(html) {
  await navigator.clipboard.writeText(html);
}
