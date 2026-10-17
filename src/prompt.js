/**
 * Master prompt for the paper-digest agent.
 *
 * One request, no repair loop. To get loop-like behaviour inside that single
 * response the agent emits up to four blocks, in order:
 *   <notes>  evidence ledger (retrieval pass; ignored by the pipeline)
 *   <draft>  document written from the ledger
 *   <check>  adversarial audit of the draft against the ledger and the source
 *   <final>  corrected document, ONLY when the check found fixes
 * Only <final> (else <draft>) is consumed: a single Markdown document with YAML
 * frontmatter for metadata and markdown body for sections. No JSON, no escaping.
 * The Markdown is consumed by src/render.js to produce the digest HTML.
 *
 * There is deliberately no citation list: the Sources and limits section is a
 * single prose paragraph.
 */

function q(s) {
  return JSON.stringify(String(s));
}

/**
 * Pull the document out of the agent's response.
 * Takes the LAST complete <final>...</final> match. Returns null if there is
 * none -- which is not necessarily failure: per the OUTPUT CONTRACT the agent
 * omits <final> when its check is clean ("Fixes to apply: 0"), in which case
 * callers should fall back to the draft (see extractDraft). Null only signals
 * genuinely missing output (e.g. a truncated response with neither block).
 *
 * @param {string} response - raw agent output
 * @returns {string|null}
 */
export function extractFinal(response) {
  const matches = [...String(response).matchAll(/<final>([\s\S]*?)<\/final>/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

/**
 * Pull the draft document out of the agent's response.
 * Takes the LAST complete <draft>...</draft> match. Returns null if there is
 * none (for example, truncated output).
 *
 * @param {string} response - raw agent output
 * @returns {string|null}
 */
export function extractDraft(response) {
  const matches = [...String(response).matchAll(/<draft>([\s\S]*?)<\/draft>/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

/**
 * Pull the evidence ledger out of the agent's response (debugging only; the
 * pipeline does not render it). Returns null if absent.
 *
 * @param {string} response - raw agent output
 * @returns {string|null}
 */
export function extractNotes(response) {
  const matches = [...String(response).matchAll(/<notes>([\s\S]*?)<\/notes>/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
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
The source text below was machine-extracted from arXiv HTML. It may contain page chrome (issue-report widgets, footers, funder lists), garbled symbols, or math written twice (a rendered form followed by LaTeX). Ignore chrome. For math, use the clean LaTeX form and never copy garbled symbols. If garbling made part of the paper unreadable, say which part in "Sources and limits" and lower that section's confidence.

SOURCE TEXT (what was read: ${whatRead}):
\`\`\`
${paperText}
\`\`\`

FIGURES (arXiv HTML, file names and element ids recorded for the template):
${figureList}
BASE URL (the arXiv HTML version actually read): ${baseUrl}

OUTPUT CONTRACT
Your entire response consists of these blocks, in this order, and nothing else: no text before, between, or after them.

<notes>
EVIDENCE LEDGER. Plain text, at most 400 words. Do not write the document here. One line per fact you will rely on, in the form "[where in the source] fact or number | use: core / diff / eval / icymi / limit". Include: every number the Evaluation section will cite; every design choice you plan to list under "In case you missed it"; and, for every claim you will judge (baseline fairness, novelty, measurement boundary), the paper's own wording or the named comparison behind it. End with one line "SUSPECT:" naming any headline number that looks off, or "none".
</notes>
<draft>
A complete first version of the document, in the DOCUMENT FORMAT below, written from the ledger: every number in it appears in the ledger.
</draft>
<check>
The audit of the draft. Part 1, format: for each numbered rule in the HARD FORMAT RULES write one line: the rule number, PASS or FAIL, and short evidence (for example "7 headings found, in order"). For each FAIL, add one line stating the exact fix.
Part 2, content, each as one line or a short list:
(C1) Name the three most load-bearing numbers or claims in Evaluation and conclusions, and for each give the ledger line and the source section it comes from, or write "not verified" and fix the draft.
(C2) For each "In case you missed it" entry, state which of the four tests in the SECTION GUIDE it passes and in a few words why it is not already covered elsewhere. Remove any that fail.
(C3) List every judging word from the TRACEABILITY paragraph that appears in the draft, with the paper's own wording that supports it, and list every place the draft attributes a result difference to a cause, with the paper's statement or "not stated". Remove or soften any without support.
(C4) State whether any statement in "My read" depends on a number or fact outside the source text; if so, mark it "not verified" or delete it.
(C5) List the seven section confidences and say why the spread is justified.
End with "Fixes to apply: N". Content fixes count as fixes.
</check>
<final>  (conditional -- write only when the check found fixes)
The document again, with every fix from the check applied. This block follows the DOCUMENT FORMAT exactly and contains only the document.
</final>

Write <final> ONLY when the check found fixes ("Fixes to apply: N" with N > 0). If the check reports "Fixes to apply: 0", do NOT write a <final> block: end the response right after </check>. The draft IS the document -- <final> would be identical to it, so writing it is unnecessary.

Each of <notes>, <draft> and <check> appears exactly once as an opening tag and once as a closing tag; <final> appears the same way only when the check found fixes, otherwise it is omitted entirely. Never write the strings <notes>, <draft>, <check>, or <final> inside any block's content. Write the notes first, then the draft, then the check, then the final (when written): do not claim a rule passes without citing evidence from the draft.

SECTION GUIDE (the seven sections, in this order)

Verdict (frontmatter). Two or three sentences: what the paper actually delivers, how far the evidence supports it, and where it is weakest. Specific enough that it could not describe a different paper.

Motivation. The problem and why the authors say it matters. End with one sentence on whether the motivation is itself convincing.

Core idea. What the method is, in the order a reimplementer would need it. Include the key equations the paper already contains. Large papers can contain several core ideas; whether something is a core idea or an "In case you missed it" entry is a judgement call, so make it and stay consistent. Embed the framework figure if one exists.

Distinguishing factor. Compare against each family of prior work separately, one short paragraph per family, naming the earlier idea when the paper itself makes it obvious. Separate "new idea" from "new packaging of a known idea". If the paper extends the authors' own earlier version, add a short "vs. their earlier version" paragraph using only what the paper says changed; otherwise say the paper describes none.

Evaluation and conclusions. Pick the results that carry the paper's claims (usually 2 to 5, plus any one surprising result). Write one paragraph per result. Each paragraph starts with a bold label naming the result, then leads with the result and how it was evaluated (benchmark, baselines, metric, scale, seeds), then gives "My read:" in a sentence or two on what that result does and does not show. Mention rigor (baselines, seeds, variance, custom metrics, different measurement boundaries) only where it changes how far that particular result can be trusted; do not audit every row. If two numbers the paper reports side by side undercut a headline claim, say so; that is reading, not cross-checking. Close with a paragraph starting "**Conclusion.**" giving the paper's own conclusion and your read of whether the evidence supports it, separating what the evidence supports from what it only suggests.

In case you missed it. Written for someone building on or reimplementing the work. These are concrete things the paper did or assumed that the other sections do not already cover: a design choice buried in the method, a hand-tuned or hard-coded part behind a general-sounding claim, an odd assumption or pruning rule and what it implies, a gap between the setting in the motivation and the setting actually tested, a clever side trick, a notable implementation detail. Test each candidate before including it:
- Is it a concrete thing the paper did, assumed, or left out, rather than a verdict on the paper? Verdicts belong in the verdict or the judgement table.
- Is it meta commentary (citation quality, venue, writing, novelty rhetoric)? Drop it.
- Is it already said in the other sections? Drop it.
- Is it a general critique? Then it belongs as one clause in a judgement-table answer, not here.
Three to six entries is typical. An empty section is better than a padded one.

Cautious judgement. Four rows, answers specific: name the baseline that is missing, the metric that is custom, the earlier work it echoes. Habits: note whether baselines are the strongest available and ran under the same budget, data, and tuning effort as far as the paper's own text shows; note when the paper defines its own figure of merit; note how many seeds, datasets, or workloads support a claim and whether variance is reported; prefer a stated uncertainty ("not verifiable from the main text", "looks suspicious, not checked") over a confident guess.

Sources and limits. One paragraph saying exactly what was read, what was not (appendix, code, supplementary, cited papers), and what could not be checked. State it once. Do not list citations.

DOCUMENT FORMAT
Produce a single Markdown document with YAML frontmatter for metadata and a markdown body for sections. No code fences, no prose before/after the frontmatter. No JSON. No string escaping needed: write plain Markdown.

---
title: Paper title
authors: Author1, Author2
venue: venue and id (e.g. "arXiv:2610.20359v1 [cs.ET]")
id: arxiv id or similar
whatRead: exactly what was read (full text / abstract only / main body without appendix)
verdict: 2-3 sentence verdict
overallConfidence: NN
---

## Motivation (Confidence: NN%)
...

## Core idea (Confidence: NN%)
Key equations written as $$ ... $$ (display) or \\( ... \\) (inline). Use raw LaTeX and write the delimiters yourself. Use \\\\ for line breaks only where the paper shows them. Figures as raw HTML: <figure data-n="N" data-a="ID"><figcaption>CAPTION</figcaption></figure> (N = figure index from the list above). Do not add an <img> tag: the pipeline adds the image or a link fallback.

## Distinguishing factor (Confidence: NN%)
...

## Evaluation and conclusions (Confidence: NN%)
**Result label.** Result and how it was evaluated. My read: ...

**Another result label.** ...

**Conclusion.** ...

## In case you missed it (Confidence: NN%)
- [pos] a positive entry
- [neg] a negative entry
- [neu] a neutral entry

## Cautious judgement (Confidence: NN%)
| Question | Answer | Confidence |
| --- | --- | --- |
| Fair comparison to external baselines? | ... | NN% |
| Invents its own FoM? | ... | NN% |
| Rewrite of an existing idea? | ... | NN% |
| Reliable enough to reuse? | ... | NN% |

## Sources and limits (Confidence: NN%)
One paragraph.

CONFIDENCE
Every section carries a percent confidence (0-100): your confidence that your reading of that section is right and complete, not a rating of the paper. Lower it when you saw only part of the text, when the source was garbled, when the paper is vague, or when judging requires baselines you did not verify. Spread should reflect real differences; do not default everything to 85%. For "Sources and limits" the number is your confidence that the statement of what was read and not read is complete, so it should not exceed 85 if any part of the source was garbled or missing. overallConfidence in the frontmatter is a bare integer 0-100.

HARD FORMAT RULES (verify each one in the check block)
1. Your response contains exactly one <notes>, one <draft> and one <check> block, in that order, plus one <final> block only when the check found fixes ("Fixes to apply: N" with N > 0), with nothing outside them.
2. Inside <final>, the first characters are "---" and the frontmatter closes with a second "---" line.
3. The frontmatter has exactly these keys in this order: title, authors, venue, id, whatRead, verdict, overallConfidence. overallConfidence is a bare integer. The verdict is 2-3 sentences. Commas in frontmatter values are followed by a space.
4. The body has exactly seven "## " headings, once each, in this order: Motivation, Core idea, Distinguishing factor, Evaluation and conclusions, In case you missed it, Cautious judgement, Sources and limits.
5. Every one of the seven headings ends with " (Confidence: NN%)" using a real number, for example "## Motivation (Confidence: 80%)".
6. The judgement table has a header row, a separator row, and exactly four data rows, with the four questions worded exactly as given and each Confidence cell a percentage.
7. Every entry in "In case you missed it" starts with "- [pos] ", "- [neg] ", or "- [neu] ", on its own line.
8. No code fences (triple backticks) anywhere in <draft> or <final>.
9. Every $$ is closed by a matching $$, and every \\( is closed by a matching \\).
10. Every <figure> has a data-n that appears in the figure list, a data-a equal to that figure's id, and a <figcaption>. There is no <img> tag. Embed at most two figures, and never one whose caption begins with "TABLE".
11. No JSON, no text before the frontmatter or after the last section, and the strings <notes>, <draft>, <check>, and <final> do not appear inside block contents.
12. Evaluation and conclusions contains no table. It has 3 to 7 paragraphs separated by blank lines; each begins with a bold label ("**...**"), every paragraph except the last contains "My read:", and the last begins with "**Conclusion.**".
13. Sources and limits contains exactly one prose paragraph, stating what was read once and not repeating it, and no list of citations.
14. The seven section confidences contain at least three distinct values, and none exceeds 90.
15. Every number cited in Evaluation and conclusions appears in the ledger.`
}