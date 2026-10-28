/**
 * Agent A — Ingest.
 *
 * Every accepted input converges on a (doc, ctx) pair and then on a `Source`:
 *   - arXiv id or URL        -> https://arxiv.org/html/<id>, fetched
 *   - any other URL          -> fetched directly
 *   - pasted raw HTML        -> parsed, URL inferred
 *   - uploaded .html         -> parsed, URL inferred
 *   - CSR Article JSON       -> converted directly (future extension hook)
 *
 * CSR parsers (arxiv, nature, ieee, acm, science) are classic scripts loaded
 * into `window.CSR`. `ingest()` assumes `window.CSR.findParsedArticle` is
 * available; `loadCsr()` injects the scripts sequentially when it isn't
 * (useful in tests and for defensive page loads).
 *
 * Figures and baseUrl belong to the app `Source`, never to the AI's Markdown.
 */

import { sessionKey } from "../store/sessions.js";

// Numeric nodeType constants so this module has no DOM dependency and works
// identically in a browser and in linkedom/vm-based tests.
const ELEMENT = 1;
const TEXT = 3;
const FRAGMENT = 11;

const HEADING_TAGS = new Set([
  "p", "div", "section", "article", "aside", "header", "footer", "nav",
  "main", "body", "html", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "table", "caption", "tr", "td", "th", "li", "dd", "dt",
  "figcaption",
]);
const BLOCK_TAGS = new Set(HEADING_TAGS);
const DROP_TAGS = new Set(["figure", "script", "style", "img", "object", "svg"]);
const ARXIV_ID_RE =
  /(?:https?:\/\/)?(?:arxiv\.org\/(?:abs|html)\/)?(?<id>\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i;
const SAVED_FROM_URL_RE = /<!--\s*saved from url\s*=\s*([^\s>]+)/i;

export class FetchBlockedError extends Error {
  constructor(url, reason) {
    super(`Failed to fetch ${url}: ${reason}`);
    this.name = "FetchBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

const USER_AGENT = "paper-digest/0.2 (https://github.com/lafqu/paper-digest)";

/* ---------------------------------------------------------------- CSR loader */

/** Load the CSR parsers into window.CSR (classic scripts, sequential). */
export async function loadCsr({ base = "." } = {}) {
  if (window.CSR && window.CSR.findParsedArticle) return;
  const order = [
    "vendor/csr/common.js",
    "vendor/csr/parsers/arxiv.js",
    "vendor/csr/parsers/nature.js",
    "vendor/csr/parsers/ieee.js",
    "vendor/csr/parsers/acm.js",
    "vendor/csr/parsers/science.js",
    "vendor/csr/parsers/index.js",
  ];
  for (const rel of order) {
    await injectScript(joinUrl(base, rel));
  }
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load CSR script ${src}`));
    document.head.appendChild(el);
  });
}

/* ---------------------------------------------------------------- Fetch */

/** Fetch a URL as text. Failures become a typed FetchBlockedError. */
export async function fetchHtml(url, { timeoutMs = 30000 } = {}) {
  let reason = "unknown";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!resp.ok) {
        reason = `HTTP ${resp.status} ${resp.statusText}`;
        throw new FetchBlockedError(url, reason);
      }
      const buf = await resp.arrayBuffer();
      const charset = /charset=\s*([\w-]+)/i.exec(
        resp.headers.get("content-type") ?? "",
      )?.[1];
      try {
        return new TextDecoder(charset ?? "utf-8").decode(buf);
      } catch (_) {
        return new TextDecoder("utf-8", { fatal: false }).decode(buf);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof FetchBlockedError) throw e;
    if (e.name === "AbortError") reason = "timeout";
    else if (e.type === "failed" || e.message.includes("Failed to fetch"))
      reason = "network";
    else reason = e.message || String(e);
    throw new FetchBlockedError(url, reason);
  }
}

function isRawHtml(text) {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype html>") || t.startsWith("<html");
}

function parseHtml(text) {
  return new DOMParser().parseFromString(text, "text/html");
}

/* ---------------------------------------------------------------- URL inference */

/** Infer a source URL for pasted/uploaded HTML (no live URL), in spec order. */
export function inferUrl(doc, { baseUrl } = {}) {
  if (baseUrl) return baseUrl;
  const canon = doc.querySelector('link[rel="canonical"]');
  if (canon && canon.getAttribute("href")) return canon.getAttribute("href");
  const og = doc.querySelector('meta[property="og:url"]');
  if (og && og.getAttribute("content")) return og.getAttribute("content");
  for (const name of [
    "citation_fulltext_html_url",
    "citation_abstract_html_url",
  ]) {
    const m = doc.querySelector(`meta[name="${name}"]`);
    if (m && m.getAttribute("content")) return m.getAttribute("content");
  }
  const saved = SAVED_FROM_URL_RE.exec(doc.documentElement.outerHTML || "");
  if (saved) return saved[1];
  const arxivId = citationMetaArxivId(doc);
  if (arxivId) return `https://arxiv.org/html/${arxivId}`;
  return null;
}

function citationMetaArxivId(doc) {
  const el =
    doc.querySelector('meta[name="citation_arxiv_id"]') ||
    doc.querySelector('meta[property="citation_arxiv_id"]');
  return el && el.getAttribute("content") ? el.getAttribute("content").trim() : null;
}

/* ---------------------------------------------------------------- CSR article -> Source */

// Tags carried verbatim through the text walker.
const VERBATIM_TAGS = new Set(["math", "mjx-container", "svg"]);

/** Collect the visible text of an element (math -> \(alttext\), once). */
function textOf(el) {
  let t = "";
  const collect = (node) => {
    if (node.nodeType === TEXT) {
      t += node.textContent;
    } else if (node.nodeType === ELEMENT) {
      const tag = node.tagName.toLowerCase();
      if (tag === "math") {
        const alt = node.getAttribute("alttext");
        if (alt) t += alt;
        return;
      }
      for (const c of node.childNodes) collect(c);
    }
  };
  collect(el);
  return t.replace(/\s+/g, " ").trim();
}

/** Serialize an inline <svg> to standalone markup (ports fetch.js serialiseSvg). */
function serialiseSvg(el) {
  let markup = el.outerHTML;
  const styleM = /style="([^"]*)"/.exec(markup);
  const vars = {};
  if (styleM) {
    for (const part of styleM[1].split(";")) {
      const kv = part.split(":");
      if (kv.length === 2 && kv[0].trim().startsWith("--")) {
        vars[kv[0].trim()] = kv[1].trim();
      }
    }
  }
  if (Object.keys(vars).length > 0) {
    for (const [name, value] of Object.entries(vars)) {
      markup = markup.replace(
        new RegExp("\\bvar\\(" + escapeRegExp(name) + "\\)", "g"),
        value,
      );
    }
    markup = markup.replace(
      /style="([^"]*)"/,
      (_, style) => {
        const rest = style
          .split(";")
          .filter((p) => !p.trim().startsWith("--"))
          .join(";")
          .trim();
        return rest ? `style="${rest}"` : "";
      },
    );
  }
  return markup;
}

const escapeRegExp = (s) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Walk a node tree to markdown-ish plain text (ports extractTextFromHtml). */
function walk(node) {
  switch (node.nodeType) {
    case TEXT:
      return node.textContent.replace(/\s+/g, " ").trim();
    case FRAGMENT: {
      return [...node.childNodes]
        .map((c) => walk(c))
        .filter(Boolean)
        .join("\n\n");
    }
    case ELEMENT: {
      const tag = node.tagName.toLowerCase();
      if (tag === "math") {
        const alt = node.getAttribute("alttext");
        return alt ? `\\(${alt}\\)` : "";
      }
      if (DROP_TAGS.has(tag)) return "";
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
        return "#".repeat(Math.min(Number(tag[1]) || 1, 2)) + " " + textOf(node);
      }
      if (tag === "table") {
        const parts = [];
        const caption = node.querySelector("caption");
        if (caption) {
          const cap = textOf(caption);
          if (cap) parts.push(cap);
        }
        for (const tr of node.querySelectorAll("tr")) {
          const cells = [...tr.querySelectorAll("th, td")].map(textOf);
          if (cells.length) parts.push("| " + cells.join(" | ") + " |");
        }
        return parts.join("\n");
      }
      const kids = [...node.childNodes]
        .map((c) => [c, walk(c)])
        .filter(([, t]) => t);
      const parts = [];
      let pending = null;
      const flush = () => {
        if (pending) {
          parts.push(pending);
          pending = null;
        }
      };
      for (const [c, t] of kids) {
        const isBlock =
          c.nodeType === ELEMENT && BLOCK_TAGS.has(c.tagName.toLowerCase());
        if (isBlock) {
          flush();
          parts.push(t);
        } else {
          pending = pending ? pending + " " + t : t;
        }
      }
      flush();
      return tag === "table" || BLOCK_TAGS.has(tag)
        ? parts.join("\n\n")
        : parts.join(" ");
    }
    default:
      return "";
  }
}

function slugify(text, fallback) {
  const base = (text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || fallback || "fig";
}

/** Generic content-based parser (app-only, not registered with CSR). */
export function genericParse(doc, ctx) {
  const { url, base } = window.CSR.util.ctx(doc, ctx);
  const body = window.CSR.util.genericArticleBody(doc, [
    "article",
    "main",
    "[role=main]",
  ]);
  if (!body) return null;
  const m = window.CSR.util.citationMeta(doc);
  const sections = [];
  const headings = body.querySelectorAll("h2, h3");
  if (!headings.length) {
    sections.push({
      id: "body",
      title: "",
      content: window.CSR.util.cloneClean(body, { baseURI: base }),
    });
  } else {
    let current = null;
    for (const node of Array.from(body.children)) {
      if (/^H[23]$/.test(node.tagName)) {
        current = {
          title: window.CSR.util.textContentOf(node),
          id: node.id || slugify(window.CSR.util.textContentOf(node)),
          nodes: [],
        };
        sections.push(current);
      } else if (current) {
        current.nodes.push(node);
      }
    }
    for (const sec of sections) {
      const wrapper = doc.createElement("div");
      sec.nodes.forEach((n) => wrapper.appendChild(window.CSR.util.cloneWithStyles(n)));
      sec.content = window.CSR.util.cloneClean(wrapper, { baseURI: base });
    }
  }
  const venueParts = [];
  if (m.journal) venueParts.push(m.journal);
  if (m.date) venueParts.push(m.date);
  if (m.doi) venueParts.push("doi:" + m.doi);
  return {
    site: "generic",
    title: m.title || window.CSR.util.textContentOf(doc.querySelector("h1")) || "Untitled",
    authors: m.authors.length ? m.authors.join(", ") : null,
    venueLine: venueParts.join(" \u00b7 "),
    sourceUrl: url,
    ids: { arxiv: m.arxivId || null, doi: m.doi || null },
    sections,
    bibliography: {},
  };
}

/** Build `paperText`: title, authors, then ## <section> + body text. */
function buildPaperText(article, { includeReferences = false } = {}) {
  const parts = [];
  if (article.title) parts.push("# " + article.title);
  if (article.authors) parts.push("Authors: " + article.authors);
  for (const sec of article.sections || []) {
    if (sec.id === "references" && !includeReferences) continue;
    if (sec.title) parts.push("## " + sec.title);
    const bodyText = walk(sec.content);
    if (bodyText) parts.push(bodyText);
  }
  return parts.join("\n\n").trim();
}

/** Figure is table-only when it has no img/object/svg inside. */
function isTableOnlyFigure(fig) {
  return !fig.querySelector("img, object, svg");
}

function resolveUrl(against, value) {
  if (!value) return "";
  if (value.startsWith("#")) return ""; // fragment-only, no resolvable image
  try {
    return new URL(value, against || "about:blank").href;
  } catch (_) {
    return ""; // cannot resolve -> fall back to link
  }
}

/** Extract figures from a CSR Article's section fragments. */
function extractFigures(article, ctx) {
  const figures = [];
  let index = 0;
  const base = ctx.base || "about:blank";
  for (const sec of article.sections || []) {
    const frag = sec.content;
    if (!frag || !frag.querySelectorAll) continue;
    for (const fig of frag.querySelectorAll("figure")) {
      if (isTableOnlyFigure(fig)) continue;
      index += 1;
      const dataA =
        fig.getAttribute("data-a") || fig.getAttribute("id") || `fig-${index}`;
      const n = String(index);
      const capEl = fig.querySelector("figcaption");
      const caption = capEl ? capEl.textContent.replace(/\s+/g, " ").trim() : "";
      let url = "";
      let svg = "";
      const img = fig.querySelector("img");
      if (img) {
        url = resolveUrl(base, img.getAttribute("src"));
      } else {
        const svgEl = fig.querySelector("svg");
        if (svgEl) {
          svg = serialiseSvg(svgEl);
        } else {
          const obj = fig.querySelector("object");
          url = resolveUrl(base, obj ? obj.getAttribute("data") : null);
        }
      }
      figures.push({ n, dataA, caption, url, svg });
    }
  }
  return figures;
}

function computeWhatRead(article, ctx, figures, includeReferences, isGeneric) {
  const sections = article.sections || [];
  const bits = [];
  bits.push(`site=${article.site}`);
  bits.push(`${sections.length} section${sections.length === 1 ? "" : "s"}`);
  bits.push(`${figures.length} figure${figures.length === 1 ? "" : "s"}`);
  if (!includeReferences) bits.push("references excluded");
  const abstractOnly =
    sections.length === 1 && sections[0] && sections[0].id === "abstract";
  if (abstractOnly) bits.push("abstract only");
  if (isGeneric) bits.push("generic extractor");
  if (ctx.url && /ieeexplore\.ieee\.org/.test(ctx.url)) bits.push("ieee");
  return bits.join("; ");
}

function primaryId(ids, sourceUrl) {
  if (ids && ids.arxiv) return ids.arxiv.replace(/v\d+$/, "");
  if (ids && ids.doi) return ids.doi;
  if (sourceUrl) {
    let h = 0;
    for (let i = 0; i < sourceUrl.length; i++) {
      h = (h << 5) - h + sourceUrl.charCodeAt(i);
      h |= 0;
    }
    return "url-" + Math.abs(h).toString(16);
  }
  return "unknown";
}

/**
 * Convert a CSR `Article` (or Article-shaped object) into a `Source`.
 *
 * @param {object} article - {site,title,authors,venueLine,sourceUrl,ids,sections:[{id,title,content}],bibliography}
 * @param {{url:string|null, base:string}} ctx
 * @param {{includeReferences?:boolean, isGeneric?:boolean}} opts
 * @returns {Source}
 */
export function articleToSource(article, ctx, opts = {}) {
  const { includeReferences = false, isGeneric = false } = opts;
  const sections = article.sections || [];
  const figures = extractFigures(article, ctx);
  const sourceUrl = article.sourceUrl || ctx.url || null;
  const baseUrl = ctx.url || null;
  const ids = article.ids || { arxiv: null, doi: null };
  const warnings = [];
  const url = ctx.url || "";
  if (!url) warnings.push("no source URL; relative links are dropped");
  if (isGeneric) warnings.push("generic extractor used (unsupported site)");
  const abstractOnly =
    sections.length === 1 && sections[0] && sections[0].id === "abstract";
  if (abstractOnly) warnings.push("abstract only (full text unavailable)");
  return {
    site: article.site || "unknown",
    ids,
    key: sessionKey(article.site || "unknown", ids, sourceUrl),
    title: article.title || "Untitled",
    authors: article.authors
      ? Array.isArray(article.authors)
        ? article.authors
        : [article.authors]
      : [],
    venue: article.venueLine || "",
    sourceUrl,
    baseUrl,
    whatRead: computeWhatRead(article, ctx, figures, includeReferences, isGeneric),
    paperText: buildPaperText(article, { includeReferences }),
    figures,
    warnings,
  };
}

/* ---------------------------------------------------------------- public entry */

/** Resolve an accepted input into a `Source`. */
export async function ingest(input) {
  const { kind, value, baseUrl } = input || {};
  let doc;
  let ctxUrl = null;

  if (kind === "csr-json") {
    const article =
      typeof value === "string" ? JSON.parse(value) : value;
    const url = article.sourceUrl || null;
    const ctx = { url, base: url || "about:blank" };
    return articleToSource(article, ctx, { isGeneric: article.site === "generic" });
  }

  let htmlText;
  if (kind === "file") {
    htmlText = await value.text();
  } else if (kind === "html") {
    htmlText = String(value);
  } else if (kind === "url") {
    // arXiv id/link -> the HTML version; anything else fetched directly.
    const m = ARXIV_ID_RE.exec(String(value).trim());
    const fetchUrl = m ? `https://arxiv.org/html/${m.groups.id}` : String(value);
    htmlText = await fetchHtml(fetchUrl);
    ctxUrl = fetchUrl;
  } else {
    throw new Error(`Unknown ingest kind: ${kind}`);
  }

  doc = parseHtml(htmlText);
  const resolvedUrl = ctxUrl || inferUrl(doc, { baseUrl });
  const ctx = { url: resolvedUrl, base: resolvedUrl || "about:blank" };

  await loadCsr();
  if (!window.CSR || !window.CSR.findParsedArticle) {
    throw new Error("CSR parsers failed to load");
  }

  let article = window.CSR.findParsedArticle(doc, ctx);
  let isGeneric = false;
  if (!article) {
    article = genericParse(doc, ctx);
    isGeneric = !!article;
  }
  if (!article) {
    throw new Error("No parser could extract article content from the document");
  }

  return articleToSource(article, ctx, { isGeneric });
}

/** Join a base directory with a relative URL for script loading. */
function joinUrl(base, rel) {
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}
