/**
 * Pure digest Markdown -> HTML renderer. No filesystem, no network: safe to use
 * in Node, in a browser, and inside Obsidian dataviewjs.
 *
 * Renders a digest object (as produced by src/digest.js from the agent's
 * Markdown response) into assets/template.html markup using `marked` for
 * Markdown parsing.
 */

import { marked } from "marked";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c] || c);
}

/**
 * Render a section's markdown content to HTML.
 *
 * Protects math ($$...$$ and \(...\)) so marked does not touch it, then
 * runs marked. Figure blocks (<figure data-n="...">...</figure>) pass
 * through as raw HTML so the browser-side template script can turn each
 * figure[data-n] into a lazyloaded image with a link fallback.
 */
function renderContent(content) {
  const t = String(content || "");
  const mathBlocks = [];
  let p = t;

  // Protect display math $$...$$ as placeholders so marked leaves them alone.
  p = p.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const idx = mathBlocks.length;
    mathBlocks.push(`\\[${math}\\]`);
    return `\x00MATH${idx}\x00`;
  });

  // Protect inline math \(...\) so marked leaves it alone.
  // Use RegExp constructor to avoid literal-slash escaping issues in regex literals.
  const inlineRe = new RegExp("\\\\\\(([\\s\\S]*?)\\\\\\)", "g");
  p = p.replace(inlineRe, (_, math) => {
    const idx = mathBlocks.length;
    mathBlocks.push(`\\(${math}\\)`);
    return `\x00MATH${idx}\x00`;
  });

  const html = marked.parse(p);

  // Restore math placeholders raw.
  let out = html;
  for (let i = 0; i < mathBlocks.length; i++) {
    out = out.replace(`\x00MATH${i}\x00`, mathBlocks[i]);
  }
  return out;
}

function confidenceChip(conf) {
  const c = conf == null ? 0 : Number(conf);
  return `<span class="conf">${c}%</span>`;
}

function chipSign(tag) {
  return { pos: "+", neg: "−", neu: "·" }[tag] || "·";
}

function renderSection(s) {
  const conf = confidenceChip(s.confidence);
  let body = "";

  switch (s.id) {
    case "mot":
    case "diff":
    case "core":
    case "eval":
      body = `<div class="prose">${renderContent(s.content || "")}</div>`;
      break;
    case "icymi":
      body =
        (s.entries || []).map(
          (e) =>
            `<div class="item"><span class="chip ${esc(
              e.tag || "neu"
            )}">${chipSign(e.tag)}</span>${esc(e.text)}</div>`
        ).join("");
      break;
    case "judge":
      body =
        `<div class="wrap"><table><thead><tr><th>Question</th><th>Answer</th><th>Conf.</th></tr></thead><tbody>` +
        (s.rows || []).map(
          (r) =>
            `<tr><td>${esc(r.question)}</td><td>${esc(r.answer)}</td><td>${
              r.conf == null ? "" : r.conf
            }%</td></tr>`
        ).join("") +
        `</tbody></table></div>`;
      break;
    case "src":
      body = `<div class="prose">${renderContent(s.content || "")}</div>`;
      break;
    default:
      body = `<div class="prose">${renderContent(s.content || "")}</div>`;
  }
  return `<h2 class="s" id="${esc(s.id)}">${esc(s.title)}${conf}</h2>${body}`;
}

/**
 * Render a digest object into a complete HTML document string.
 *
 * @param {object} digest - parsed digest object (metadata + sections)
 * @param {object} [source] - resolved source (figures, baseUrl) for the figure pipeline
 * @returns {string} HTML
 */
export function render(digest, source = {}) {
  const figures = Array.isArray(source.figures) ? source.figures : [];
  const base = source.baseUrl || "";

  const map = {};
  figures.forEach((f, i) => {
    const key = String(i + 1);
    map[key] = f.url || f.src || f.dataA || "";
  });
  const mapJson = JSON.stringify(map);

  const navLinks = (digest.sections || [])
    .map((s) => `<a class="block py-1" href="#${esc(s.id)}">${esc(s.title)}</a>`)
    .join("");

  const sectionsHtml = (digest.sections || []).map((s) => renderSection(s)).join("");

  // Inject  tags into <figure data-n="..."> elements server-side so the
  // static HTML already contains images (lazyloaded, with link fallback).
  let sectionsWithImages = sectionsHtml;
  const figureRe = /<figure\b[^>]*>([\s\S]*?)<\/figure>/g;
  sectionsWithImages = sectionsWithImages.replace(figureRe, (match, inner) => {
    const nMatch = /data-n="([^"]+)"/.exec(match);
    if (!nMatch) return match;
    const n = nMatch[1];
    if (/<img\b/.test(inner)) return match; // already has an image
    const url = map[n] || "";
    if (!url) return match;
    const img = `<img loading="lazy" alt="Figure ${n}" src="${esc(url)}">`;
    return match.replace(">", `>${img}`);
  });

  const citationsHtml = ((digest.sections || []).find((s) => s.id === "src") || {})
    .citations || [];
  const citations = citationsHtml.map((c) => `<p class="cite">${esc(c)}</p>`).join("");

  const mapJs = Object.entries(map)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");

  // assets/template.html is read separately and placeholders replaced here.
  const placeholders = {
    "{{TITLE}}": esc(digest.title || ""),
    "{{AUTHORS}}": esc(Array.isArray(digest.authors) ? digest.authors.join(", ") : String(digest.authors || "")),
    "{{VENUE}}": esc(digest.venue || ""),
    "{{ID}}": esc(digest.id || ""),
    "{{WHAT_READ}}": esc(digest.whatRead || ""),
    "{{VERDICT}}": esc(digest.verdict || ""),
    "{{OVERALL_CONF}}": esc(digest.overallConfidence || 0),
    "{{SECTIONS}}": sectionsWithImages,
    "{{CITATIONS}}": citations,
    "{{NAV_LINKS}}": navLinks,
    "{{BASE}}": esc(base),
    "{{MAP}}": mapJson,
  };

  return { placeholders, mapJs };
}

export { esc as escapeHtml };
