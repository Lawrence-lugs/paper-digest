# paper-digest — frozen contracts (Phase 0)

These contracts are the boundaries between the ingest (A), pipeline (B), and
app/store (C) layers. They are intentionaly stable: the lead changes them, and
any agent who needs a change writes it in `docs/handoff/<agent>.md` for the
lead to apply between phases.

```js
/** @typedef {{n:string, dataA:string, caption:string, url:string, svg:string}} Figure */
/** @typedef {{site:string, ids:{arxiv?:string|null, doi?:string|null}, key:string,
 *   title:string, authors:string[], venue:string, sourceUrl:string|null,
 *   baseUrl:string|null, whatRead:string, paperText:string,
 *   figures:Figure[], warnings:string[]}} Source */
/** @typedef {{meta:{title,authors:string[],venue,id,whatRead,verdict,overallConfidence},
 *   sections:{id:string,title:string,confidence:number|null,content:string,
 *   entries?:{text:string,tag:string}[], rows?:{question:string,answer:string,conf:number}[]}[],
 *   raw:string}} Digest */
/** @typedef {{key:string, site:string, ids:{arxiv?:string|null, doi?:string|null},
 *   title:string, sourceUrl:string|null, baseUrl:string|null,
 *   figures:Figure[], createdAt:number, digestMd?:string|null}} Session */

/* ---------------------------------------------------------------- ingest (A) */

/**
 * Resolve any accepted input to a `Source`.
 *
 * @param {{kind:'url'|'html'|'file'|'csr-json', value:string|File,
 *   baseUrl?:string}} input
 * @returns {Promise<Source>}
 */
export async function ingest(input) { throw new Error("NotImplemented"); }

/* ---------------------------------------------------------------- pipeline (B) */

/**
 * Build the master prompt from a Source. Prompt contract unchanged: one
 * request, <notes>/<draft>/<check>/<final>, parser takes <final> else <draft>.
 * Figures come from Source (never injected into the AI's Markdown).
 *
 * @param {Source} source
 * @returns {string}
 */
export function buildPrompt(source) { throw new Error("NotImplemented"); }

/**
 * Run the full digest: build prompt, ask the LLM client, unwrap <final>/<draft>,
 * salvage frontmatter, return {digest, raw}.
 *
 * @param {Source} source
 * @param {LLMClient} client
 * @param {{timeoutS?:number}} cfg
 * @returns {Promise<{digest:Digest, raw:string}>}
 */
export async function runDigest(source, client, cfg) { throw new Error("NotImplemented"); }

/**
 * Unwrap an agent response: <final> else <draft>. Salvage YAML frontmatter.
 *
 * @param {string} text
 * @returns {Digest}
 */
export function parseDigest(text) { throw new Error("NotImplemented"); }

/**
 * Render a Digest into sanitized HTML (section HTML + inlined paper SVG run
 * through DOMPurify with an SVG profile). Figures are resolved from the
 * supplied {figures, baseUrl}; the template's own script adds image/link
 * fallbacks.
 *
 * @param {Digest} digest
 * @param {{figures:Figure[], baseUrl:string|null}} ctx
 * @returns {Promise<string>} HTML string
 */
export async function renderDigest(digest, ctx) { throw new Error("NotImplemented"); }

/**
 * Output filename for a digest: Author-year-journalabbv-shortenedtitle.
 *
 * @param {Digest} digest
 * @returns {string}
 */
export function filenameFor(digest) { throw new Error("NotImplemented"); }

/** Open rendered HTML in a new tab (Blob URL). */
export function openInTab(html, tabHandle) { throw new Error("NotImplemented"); }
/** Download rendered HTML as a file. */
export function downloadHtml(html, filename) { throw new Error("NotImplemented"); }
/** Copy rendered HTML to the clipboard. */
export function copyHtml(html) { throw new Error("NotImplemented"); }

/** @typedef {{chat(system:string, user:string): Promise<string>}} LLMClient */

/* ---------------------------------------------------------------- store (C) */

/** @typedef {{put: (s:Session)=>Promise<void>,
 *   get: (key:string)=>Promise<Session|null>,
 *   findByDigest: (d:Digest)=>Promise<Session|null>,
 *   list: ()=>Promise<Session[]>}} Sessions */

export const sessions = {
  put: async (s) => { throw new Error("NotImplemented"); },
  get: async (k) => { throw new Error("NotImplemented"); },
  findByDigest: async (d) => { throw new Error("NotImplemented"); },
  list: async () => { throw new Error("NotImplemented"); },
};

/**
 * Session key: <site>:<primary id>, primary id = arXiv id (version stripped),
 * else DOI, else a hash of the URL.
 */
export function sessionKey(site, ids) { throw new Error("NotImplemented"); }

/**
 * findByDigest tries, in order:
 *  1. the normalized id (arXiv id or DOI regex, version stripped),
 *  2. the normalized title,
 *  3. a manual pick from "recent sessions".
 * If all fail, the UI offers "Attach source" and renders figure links, never
 * blank figures.
 */
```

### Notes

- Figures and `baseUrl` belong to the app `Session` store, never to the AI's
  Markdown. The old `figures:`/`baseUrl:` frontmatter injection in `cli.js` is
  deleted. This fixes the template-flow bug (a standalone/clipboard-pasted
  digest previously had no figures, so every `<figure>` rendered empty).
- Output opens in a new tab (Blob URL), with Download .html and Copy HTML as
  alternatives. No embedded preview. `assets/template.html` stays the single
  template; the template's own script keeps injecting the reading marker.
- LLM access goes through an `LLMClient` interface (OpenRouter direct from the
  browser, any OpenAI-compatible base URL such as local Ollama, or an optional
  local-backend URL). The prompt flow needs no LLM at all.
- The API key is memory-only by default; "Remember on this device" is opt-in
  with a warning.
