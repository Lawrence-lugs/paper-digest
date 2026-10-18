/**
 * Agent B — render.
 *
 * Renders a `Digest` into the self-contained `assets/template.html` page.
 *
 * - Markdown body -> HTML via `marked`, with math ($$...$$, \(...\)) protected
 *   so marked never touches it and MathJax sees the original delimiters.
 * - Section HTML and inlined paper SVG figures run through DOMPurify (html +
 *   svg profiles); scripts, on* handlers and foreignObject are stripped.
 * - Figures (data-n) are resolved from the supplied `figures`: inline SVG or
 *   raster image; anything else is left for the template's own client script
 *   which adds the lazy image + "Open Fig. N" link fallback.
 * - Output is a full HTML document string (Blob-URL / download / copy target).
 */

import { marked } from "../../vendor/lib/marked.esm.js";
import createDOMPurify from "../../vendor/lib/dompurify.es.mjs";
const DOMPurify = createDOMPurify(window);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c] || c);
}

const TEMPLATE_URL = new URL("assets/template.html", window.location.href).href;
let templateCache = null;

async function loadTemplate() {
  if (!templateCache) {
    const resp = await fetch(TEMPLATE_URL);
    if (!resp.ok) throw new Error(`Failed to load template: ${resp.status} ${resp.statusText}`);
    templateCache = await resp.text();
  }
  return templateCache;
}

/* ---------------------------------------------------------------- math */

// Protect math so `marked` leaves it untouched; MathJax reads the original
// delimiters from the DOM afterwards. Policy (decided): only $$...$$ and
// \(...\) are math. A lone single `$` is literal text (currency-safe), per
// the prompt contract which uses \( ... \) for inline math.
function protectMath(text) {
  const blocks = [];
  let p = String(text || "");

  p = p.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const idx = blocks.length;
    blocks.push(`\\[${math}\\]`);
    return `\x00MATH${idx}\x00`;
  });

  const inlineRe = new RegExp("\\\\\\(([\\s\\S]*?)\\\\\\)", "g");
  p = p.replace(inlineRe, (_, math) => {
    const idx = blocks.length;
    blocks.push(`\\(${math}\\)`);
    return `\x00MATH${idx}\x00`;
  });

  return { p, blocks };
}

function restoreMath(html, blocks) {
  let out = html;
  for (let i = 0; i < blocks.length; i++) {
    // Replace the placeholder with escaped math so it can never break the
    // surrounding HTML; MathJax reads the unescaped text from the DOM.
    out = out.replace(`\x00MATH${i}\x00`, () => esc(blocks[i]));
  }
  return out;
}

/* ---------------------------------------------------------------- section rendering */

function confidenceChip(conf) {
  const c = conf == null ? 0 : Number(conf);
  return `<span class="conf">${c}%</span>`;
}

function chipSign(tag) {
  return { pos: "+", neg: "−", neu: "·" }[tag] || "·";
}

function renderParagraph(content) {
  const html = renderContent(content).trim();
  const m = /^<p>([\s\S]*)<\/p>$/.exec(html);
  return m ? m[1] : html;
}

function renderSection(s) {
  const conf = confidenceChip(s.confidence);
  let body = "";
  switch (s.id) {
    case "mot":
    case "diff":
    case "core":
      body = `<div class="prose">${renderContent(s.content || "")}</div>`;
      break;
    case "eval":
      body = (s.content || "")
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<div class="item">${renderParagraph(p)}</div>`)
        .join("");
      break;
    case "icymi":
      body = (s.entries || [])
        .map(
          (e) =>
            `<div class="item"><span class="chip ${esc(
              e.tag || "neu",
            )}">${chipSign(e.tag)}</span>${esc(e.text)}</div>`
        )
        .join("");
      break;
    case "judge":
      body =
        `<div class="wrap"><table><thead><tr><th>Question</th><th>Answer</th><th>Conf.</th></tr></thead><tbody>` +
        (s.rows || [])
          .map(
            (r) =>
              `<tr><td>${esc(r.question)}</td><td>${esc(r.answer)}</td><td>${
                r.conf == null ? "" : r.conf
              }%</td></tr>`
          )
          .join("") +
        `</tbody></table></div>`;
      break;
    case "src":
    default:
      body = `<div class="prose">${renderContent(s.content || "")}</div>`;
  }
  return `<h2 class="s" id="${esc(s.id)}">${esc(s.title)}${conf}</h2>${body}`;
}

/**
 * Render one section's markdown content to HTML. Math is protected before
 * `marked` and restored (escaped) afterwards.
 */
function renderContent(content) {
  const { p, blocks } = protectMath(content);
  const html = marked.parse(p);
  return restoreMath(html, blocks);
}

/* ---------------------------------------------------------------- figures */

// Scale an inlined SVG to the column width.
function scaleSvg(svg) {
  return String(svg).replace(/<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs;
    if (!/viewBox\b/.test(a)) {
      const wM = /width\s*=\s*"(\d+)"/.exec(a);
      const hM = /height\s*=\s*"(\d+)"/.exec(a);
      if (wM && hM) a += ` viewBox="0 0 ${wM[1]} ${hM[1]}"`;
    }
    a = a.replace(/\bwidth\s*=\s*"[^"]*"/, 'width="100%"');
    a = a.replace(/\bheight\s*=\s*"[^"]*"/, 'height="auto"');
    if (!/style\s*=/i.test(a)) {
      a += ' style="display:block"';
    } else {
      a = a.replace(/style="([^"]*)"/, 'style="$1;display:block"');
    }
    return `<svg${a}>`;
  });
}

/**
 * Inline figures into the sections HTML. For each <figure data-n="N">:
 *  - svg available -> inline scaled + sanitized SVG
 *  - url available -> inline lazy image
 *  - otherwise -> leave the (figcaption-only) figure for the template's own
 *    client script, which adds the image and the "Open Fig. N" fallback.
 *
 * Function replacers are used so `$` sequences in SVG text are never
 * mangled by String.replace replacement patterns.
 */
function inlineFigures(sectionsHtml, figures) {
  const byN = {};
  figures.forEach((f, i) => {
    const key = String(f.n != null ? f.n : i + 1);
    byN[key] = f;
  });

  return sectionsHtml.replace(
    /<figure\b[^>]*>([\s\S]*?)<\/figure>/g,
    (match, inner) => {
      const nMatch = /data-n="([^"]+)"/.exec(match);
      if (!nMatch) return match;
      const n = nMatch[1];
      const f = byN[n];
      if (!f) return match;

      if (f.svg) {
        const safeSvg = sanitizeHtml(scaleSvg(f.svg), { svg: true });
        // Insert the SVG right after the opening <figure ...> tag.
        return match.replace(">", (m) => m + safeSvg);
      }
      if (f.url) {
        const img = `<img loading="lazy" alt="Figure ${n}" src="${esc(f.url)}">`;
        return match.replace(">", (m) => m + img);
      }
      return match; // no image/SVG: client script adds the link fallback
    },
  );
}

/* ---------------------------------------------------------------- sanitize */

/** DOMPurify with html + svg profiles; allow figure anchors and math tags. */
function sanitizeHtml(html, { svg = false } = {}) {
  const config = {
    USE_PROFILES: { html: true, ...(svg ? { svg: true } : {}) },
    ADD_TAGS: ["figure", "figcaption", "mjx-container", "math"],
    ADD_ATTR: ["data-n", "data-a"],
    FORCE_BODY: false,
  };
  return DOMPurify.sanitize(String(html || ""), config);
}

/* ---------------------------------------------------------------- public */

/**
 * Render a Digest into a complete, sanitized HTML document string.
 *
 * @param {{meta:{title,authors:string[],venue,id,whatRead,verdict,overallConfidence},
 *   sections:{id,title,confidence,content,entries?,rows?}[]}} digest
 * @param {{figures:{n,dataA,caption,url,svg}[], baseUrl:string|null}} ctx
 * @returns {Promise<string>}
 */
export async function renderDigest(digest, ctx = {}) {
  const figures = Array.isArray(ctx.figures) ? ctx.figures : [];
  const base = ctx.baseUrl || "";

  const sectionsHtml = (digest.sections || [])
    .map((s) => renderSection(s))
    .join("");
  // svg: true so inlined paper SVG figures survive; scripts/foreignObject/on*
  // are still stripped by DOMPurify's svg profile.
  const safeSections = sanitizeHtml(inlineFigures(sectionsHtml, figures), { svg: true });

  const navLinks = (digest.sections || [])
    .map((s) => `<a class="block py-1" href="#${esc(s.id)}">${esc(s.title)}</a>`)
    .join("");

  const meta = digest.meta || {};
  const authors = Array.isArray(meta.authors) ? meta.authors.join(", ") : String(meta.authors || "");

  const tmpl = await loadTemplate();
  let html = tmpl
    .split("{{TITLE}}").join(esc(meta.title || ""))
    .split("{{AUTHORS}}").join(esc(authors))
    .split("{{VENUE}}").join(esc(meta.venue || ""))
    .split("{{ID}}").join(esc(meta.id || ""))
    .split("{{WHAT_READ}}").join(esc(meta.whatRead || ""))
    .split("{{VERDICT}}").join(esc(meta.verdict || ""))
    .split("{{OVERALL_CONF}}").join(esc(meta.overallConfidence || 0))
    .split("{{SECTIONS}}").join(safeSections)
    .split("{{NAV_LINKS}}").join(navLinks)
    .split("{{BASE}}").join(esc(base))
    .split("{{MAP}}").join(JSON.stringify({}));

  // {{MAP}} was replaced by the split/join above, so the template now has
  // `const MAP = {};`. No second replace is needed.
  return html;
}

export { esc, sanitizeHtml, renderContent };
