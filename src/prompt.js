/**
 * Master prompt for the paper-digest agent.
 *
 * Keeps the logical and writing guides from the paper-digest skill, but
 * instructs the agent to emit a single JSON object instead of HTML. The JSON
 * schema is consumed by src/template.js to render the digest HTML.
 */

const INDENT = "  ";

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
      (f) =>
        `    - data-n=${q(f.n)} data-a=${q(f.dataA)} caption=${q(f.caption)} src=${q(f.src)} url=${q(f.url)}`
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

TASK: Produce a single JSON object (no markdown fences, no prose before/after) with exactly this schema:

{
  "title": string,                          // paper title
  "authors": string[],                      // author surnames as in the paper
  "venue": string,                          // venue and id (e.g. "NeurIPS 2017", "arXiv:2301.00001")
  "id": string,                             // arxiv id or similar
  "whatRead": string,                       // exactly what was read (full text / abstract only / main body without appendix)
  "verdict": string,                        // 2-3 sentence verdict
  "overallConfidence": number,              // 0-100
  "sections": [
    { "id": "mot", "title": "Motivation", "content": string, "confidence": number },
    { "id": "core", "title": "Core idea", "content": string, "confidence": number, "equations": string[], "figureId": string|null },
    { "id": "diff", "title": "Distinguishing factor", "content": string, "confidence": number },
    { "id": "eval", "title": "Evaluation and conclusions", "content": string, "confidence": number, "results": string[], "conclusion": string },
    { "id": "icymi", "title": "In case you missed it", "entries": [{ "text": string, "tag": "pos|neg|neu" }] },
    { "id": "judge", "title": "Cautious judgement", "rows": [{ "question": string, "answer": string, "conf": number }] },
    { "id": "src", "title": "Sources and limits", "content": string, "citations": string[] }
  ]
}

Section-by-section requirements (in this order):

1. Header + Verdict: title, authors, venue and id, what was read, a 2-3 sentence verdict, and overall confidence.

2. Motivation ("mot"): the problem and why the authors say it matters. Add a line on whether the motivation is itself convincing.

3. Core idea ("core"): include the key equations as raw LaTeX (no inline or display math delimiters — the template wraps display equations in \[ \]). Use \\ for line breaks only where the paper shows them. Reference the framework figure by its data-a id if one exists.

4. Distinguishing factor ("diff"): compare against each family of prior work separately. If the paper extends the authors' own earlier version, add a short "vs. their earlier version" paragraph. Do not go and fetch the earlier version.

5. Evaluation and conclusions ("eval"): prose in the same style, no table. Pick the results that carry the paper's claims (usually 2 to 5, plus any one surprising). For each: lead with the result and how it was evaluated (benchmark, baselines, metric, scale), then a sentence or two of "my read". Close with an entry for the paper's own conclusion and your read of whether the evidence supports it. Mention rigor (baselines, seeds, variance, custom metrics) only where it changes how far a result can be trusted.

6. In case you missed it ("icymi"): interesting concrete things the paper did or assumed that someone building on or reimplementing the work would want to know (design choices, hard-coded or hand-tuned parts, odd assumptions/pruning rules, gaps between motivation and tested setting, clever side tricks, implementation details). 3-6 typical entries; an empty section is better than padding.

   Test each candidate:
   - Is it a concrete thing the paper did, assumed, or left out? (Verdicts belong in the Verdict or judgement table.)
   - Is it meta commentary on the paper (citation quality, reference size, venue, writing, novelty rhetoric)? Drop it.
   - Is it already said in sections 2-5 or 7? Drop it.
   - If it is a general critique not already elsewhere, does it change a judgement-table answer? If so, put one clause in that answer; if not, drop it.

   Each entry tagged: "pos" (+), "neg" (-), or "neu" (·).

7. Cautious judgement ("judge"): exactly these four rows, in this order:
   - "Fair comparison to external baselines?"
   - "Invents its own FoM?"
   - "Rewrite of an existing idea?"
   - "Reliable enough to reuse?"
   Answers should be specific (name the missing baseline, the custom metric, the earlier work it echoes), not "somewhat".

8. Sources and limits ("src"): what was read, what was not (appendix, code, supplementary), and what could not be checked. Then .cite lines, one per paper you actually saw named in the source, formatted as a Google Scholar search string: "exact title" first-author-surname year. Never reconstruct a citation from memory.

Confidence: every section carries a percent confidence (0-100), your confidence that your reading of that section is right and complete - not a rating of the paper. Spread should reflect real differences; do not default everything to 85%.

LaTeX: write < as &lt; (or \\lt) inside math so the JSON/HTML pipeline does not eat it.

Escape all strings properly for JSON. Output only the JSON object.`
}
