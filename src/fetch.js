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

import { parseHTML } from "linkedom";

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
    // Decode explicitly at the single place bytes become a string: honor the
    // declared charset, falling back to UTF-8 (never rely on the default).
    const buf = await resp.arrayBuffer();
    const charset = /charset=\s*([\w-]+)/i.exec(resp.headers.get("content-type") ?? "")?.[1];
    try {
      return new TextDecoder(charset ?? "utf-8").decode(buf);
    } catch (_) {
      return new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
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

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Serialise an inline <svg> element to markup that stands on its own.
 *
 * LaTeXML SVGs paint with CSS custom properties (e.g. --ltx-fill-color)
 * defined in the element's inline style and in arXiv's stylesheet. Without
 * that stylesheet `var(--ltx-fill-color)` is undefined, so resolve the
 * custom properties declared on the element itself to literal colours and
 * drop the now-resolved declarations.
 */
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

/**
 * Extract <figure> entries (real figures only, never tables).
 *
 * Supports two shapes:
 *  - arXiv/LaTeXML: <figure class="ltx_figure" id="S2.F1"><svg ...>...</svg><figcaption>...</figcaption></figure>
 *  - legacy/digest: <figure data-n="1" data-a="S2.F1"><figcaption>...</figcaption></figure>
 *
 * Each entry records the sequential index, the data-a id (or id attribute),
 * the caption, and either an image URL resolved against baseUrl (for ``
 * or `<object data>`) or the serialised inline `<svg>` markup. `ltx_table`
 * elements (and figures wrapping tables) are excluded.
 */
function parseFigures(html, baseUrl) {
  const { document } = parseHTML(html);

  const figures = [];
  let index = 0;

  for (const fig of document.querySelectorAll(
    "figure.ltx_figure, figure[data-n], figure[data-a]",
  )) {
    if (fig.classList.contains("ltx_table")) continue;

    const dataA = fig.getAttribute("data-a") || fig.getAttribute("id") || "";
    const nAttr = fig.getAttribute("data-n");
    if (!dataA && !nAttr) continue;

    index += 1;
    const n = nAttr || dataA || String(index);

    const captionEl = fig.querySelector("figcaption");
    const caption = captionEl
      ? captionEl.textContent.replace(/\s+/g, " ").trim()
      : "";

    let url = "";
    let svg = "";

    const img = fig.querySelector("img");
    if (img) {
      const src = img.getAttribute("src");
      if (src) url = new URL(src, baseUrl).href;
    } else {
      const svgEl = fig.querySelector("svg");
      if (svgEl) {
        svg = serialiseSvg(svgEl);
      } else {
        const obj = fig.querySelector("object");
        const data = obj ? obj.getAttribute("data") : null;
        if (data) url = new URL(data, baseUrl).href;
      }
    }

    figures.push({ n, dataA, caption, url, svg });
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

export { FetchError, parseFigures };
