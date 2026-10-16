/**
 * Master prompt for the paper-digest agent.
 *
 * Instructs the agent to emit a single Markdown document with YAML frontmatter
 * for metadata and markdown body for sections. No JSON, no escaping. The
 * Markdown is consumed by src/render.js to produce the digest HTML.
 */

function q(s) {
  return JSON.stringify(String(s));
}

/**
 * Build the master prompt given the paper source text and figure metadata.
 *
 * @param {string} paperText - the extracted paper text (HTML stripped or PDF text)
 * @param {object[]} figures - { n, dataA, caption, src, url }
 * @param {string} baseUrl - the arXiv HTML URL actually read
 * @param {string} whatRead - note of what was read (full text / abstract only / ...)
 * @returns {string}
 */
export function buildMasterPrompt({ paperText, figures = [], baseUrl = "", whatRead = "" }) {
  const figureList = figures
    .map(
      (f, i) =>
        `    - index=${i + 1} data-n=${q(i + 1)} data-a=${q(f.dataA)} caption=${q(f.caption)} url=${q(f.url)}`
    )
    .join("\n")
    || "    (none)";

  return `You are a careful, skeptical research-paper reader. Write for a technical reader at graduate level: no simplifying, no padding, no restating the abstract. Every section should tell the reader something they could not get from the abstract alone. When the paper says something and you think otherwise, keep the two apart: what the paper reports versus "my read".

Effort budget: a digest is a second-pass read, not a review. Read the paper once, carefully, then write. Do not go to a third pass unless explicitly asked.

Do not:
- inspect derivations or proofs;
- reformalize the paper's problem into equations it does not already contain;
- open, fetch, or search for any cited paper (including the authors' earlier version);
- check arithmetic, or cross-check numbers between tables, text, and figures.

Exception: cross-check a headline number (abstract, verdict, main results) only if something about it looks off; if confirming it is not trivial, say it looks suspicious and move on.

Everything you write should be traceable to what the paper says or does on the page. A claim that needs outside work to establish is either stated as "not verified" or left out.

SOURCE TEXT (what was read: ${whatRead}):
\`\`\`
${paperText}
\`\`\`

FIGURES (arXiv HTML, file names and element ids recorded for the template):
${figureList}
BASE URL (the arXiv HTML version actually read): ${baseUrl}

TASK: Produce a single Markdown document with YAML frontmatter for metadata and a markdown body for sections. No code fences, no prose before/after the frontmatter. No JSON. No string escaping needed — write plain Markdown.

---
title: Paper title
authors: Author1, Author2
venue: venue and id (e.g. "arXiv:2610.20359v1 [cs.ET]")
id: arxiv id or similar
whatRead: exactly what was read (full text / abstract only / main body without appendix)
verdict: 2-3 sentence verdict
overallConfidence: 90
---

## Motivation
The problem and why the authors say it matters. Add a line on whether the motivation is itself convincing.

## Core idea
The key ideas, with key equations written inline as \$\$ ... \$\$ (display) or \\( ... \\) (inline). Use raw LaTeX and write the delimiters yourself. Use \\ for line breaks only where the paper shows them. You may embed figures as raw HTML <figure data-n="N" data-a="ID">...</figure> tags (N = figure index from the list above). No escaping needed.

## Distinguishing factor
Compare against each family of prior work separately. If the paper extends the authors' own earlier version, add a short "vs. their earlier version" paragraph. Do not go and fetch the earlier version.

## Evaluation and conclusions
Prose in the same style. Pick the results that carry the paper's claims (usually 2 to 5, plus any one surprising). For each: lead with the result and how it was evaluated, then a sentence or two of "my read". Close with the paper's own conclusion and your read of whether the evidence supports it.

## In case you missed it
Interesting concrete things the paper did or assumed that someone building on or reimplementing the work would want to know. Write as a tag list:

- [pos] a positive entry
- [neg] a negative entry
- [neu] a neutral entry

3-6 typical entries; an empty section is better than padding.

Tags: "pos" (+), "neg" (-), or "neu" (·).

## Cautious judgement
Exactly these four rows, in this order:

| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | ... | 90% |
| Invents its own FoM? | ... | 90% |
| Rewrite of an existing idea? | ... | 90% |
| Reliable enough to reuse? | ... | 90% |

Answers should be specific, not "somewhat".

## Sources and limits
What was read, what was not (appendix, code, supplementary), and what could not be checked. 

Confidence: every section carries a percent confidence (0-100), your confidence that your reading of that section is right and complete - not a rating of the paper. Spread should reflect real differences; do not default everything to 85%.

Figures: embed important figures inline as raw HTML <figure data-n="N" data-a="ID"><figcaption>CAPTION</figcaption></figure>, where N is the figure's index (1, 2, ...) and ID is its data-a id from the figure list above. Do not add an  tag yourself — the pipeline adds it as a lazyloaded image with a link fallback.

Equations: write display equations as \$\$ ... \$\$ and inline equations as \\( ... \\). No escaping needed — write raw LaTeX directly.

Output only the Markdown document.`
}
