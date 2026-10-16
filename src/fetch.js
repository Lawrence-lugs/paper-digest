/**
 * Fetch pipeline for paper sources.
 *
 * Resolves a user-supplied source into HTML text plus asset metadata:
 *
 *  - an arXiv link / id -> the arXiv HTML version
 *    (https://arxiv.org/html/<id>), falling back to the abstract page only
 *    when no HTML version exists;
 *  - a general link -> fetched directly;
 *  - raw HTML text -> used as-is;
 *  - a local PDF path -> marked as pdf (caller decides how to extract text).
 *
 * HTML inputs may arrive with a folder of the same name holding assets, or
 * with inline image links (directly copied outerHTML). This module returns the
 * raw HTML together with a figure map so the template stage can prepend image
 * URLs.
 */

const USER_AGENT = "paper-digest/0.1 (https://github.com/lafqu/paper-digest)";

class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchError";
  }
}

const ARXIV_ID_RE = /(?:https?:\/\/)?(?:arxiv\.org\/(?:abs|html)\/)?(?<id>\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i;

function isRawHtml(text) {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype html>") || t.startsWith("<html");
}

async function _fetch(url, { timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new FetchError(`failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractArxivId(text) {
  const m = ARXIV_ID_RE.exec(text.trim());
  return m ? m.groups.id : null;
}

function arxivHtmlUrl(arxivId) {
  return `https://arxiv.org/html/${arxivId}`;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseTitle(html) {
  const m = /<h1 class="title mathjax">\s*Title:\s*(?<t>.*?)\s*<\/h1>/i.exec(html);
  return m ? stripTags(m.groups.t) : null;
}

/**
 * Extract <figure data-n=".." data-a="..">..<img src=".."> entries.
 */
function parseFigures(html, baseUrl) {
  const figures = [];
  const figureRe = /<figure\b[^>]*data-n="([^"]+)"[^>]*data-a="([^"]+)"[^>]*>([\s\S]*?)<img\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/figure>/gi;
  let m;
  while ((m = figureRe.exec(html)) !== null) {
    const inner = m[3];
    const capM = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner);
    const caption = capM ? stripTags(capM[1]) : "";
    const src = m[4];
    figures.push({
      n: m[1],
      dataA: m[2],
      caption,
      src,
      url: new URL(src, baseUrl).href,
    });
  }
  return figures;
}

/**
 * Resolve *source* into a Source descriptor.
 *
 * @param {string} source - arxiv id/link, url, html text, or pdf path
 * @param {object} [opts]
 * @param {string} [opts.assetFolder] - folder beside an HTML file holding assets
 * @returns {Promise<{kind:string, value:string, html?:string, title?:string, authors:string[], figures:object[], baseUrl?:string, assetFolder?:string}>}
 */
export async function resolve(source, { assetFolder } = {}) {
  source = String(source).trim();

  // Raw HTML text.
  if (isRawHtml(source)) {
    return {
      kind: "html",
      value: source,
      html: source,
      title: parseTitle(source),
      authors: [],
      figures: parseFigures(source, "https://localhost/"),
      baseUrl: undefined,
      assetFolder,
    };
  }

  // Local PDF path.
  if (source.toLowerCase().endsWith(".pdf")) {
    const fs = await import("fs");
    if (fs.existsSync(source)) {
      return {
        kind: "pdf",
        value: source,
        title: undefined,
        authors: [],
        figures: [],
        baseUrl: undefined,
        assetFolder,
      };
    }
    throw new FetchError(`PDF not found: ${source}`);
  }

  const arxivId = extractArxivId(source);
  if (arxivId) {
    const htmlUrl = arxivHtmlUrl(arxivId);
    try {
      const html = await _fetch(htmlUrl);
      const figures = parseFigures(html, htmlUrl);
      return {
        kind: "arxiv",
        value: arxivId,
        html,
        title: parseTitle(html),
        authors: [],
        figures,
        baseUrl: htmlUrl,
        assetFolder,
      };
    } catch (err) {
      // Fall back to abstract page only; PDF handled separately by caller.
      const absHtml = await _fetch(`https://arxiv.org/abs/${arxivId}`);
      return {
        kind: "arxiv",
        value: arxivId,
        html: absHtml,
        title: parseTitle(absHtml),
        authors: [],
        figures: [],
        baseUrl: htmlUrl,
        assetFolder,
      };
    }
  }

  // General URL.
  const html = await _fetch(source);
  return {
    kind: "url",
    value: source,
    html,
    title: parseTitle(html),
    authors: [],
    figures: parseFigures(html, source),
    baseUrl: source,
    assetFolder,
  };
}

export { FetchError };
