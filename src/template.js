/**
 * Template stage: render a digest JSON object into assets/template.html and
 * write the self-contained HTML file to disk.
 *
 * The pure render logic lives in src/render.js (browser / Obsidian safe);
 * this module only adds filesystem I/O.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { render, esc } from "./render.js";

const TEMPLATE_PATH = join(process.cwd(), "assets", "template.html");

let templateCache = null;

async function loadTemplate() {
  if (!templateCache) {
    templateCache = await readFile(TEMPLATE_PATH, "utf8");
  }
  return templateCache;
}

/**
 * Render the digest JSON into a full HTML document string.
 *
 * @param {object} digest - parsed digest object
 * @param {object} [source] - resolved source (figures, baseUrl)
 * @returns {Promise<string>} HTML
 */
export async function renderString(digest, source = {}) {
  const tmpl = await loadTemplate();
  const { placeholders, mapJs } = render(digest, source);

  let html = tmpl;
  for (const [token, value] of Object.entries(placeholders)) {
    html = html.split(token).join(value);
  }
  html = html.replace("const MAP = {{MAP}};", `const MAP = {\n${mapJs}\n  };`);
  return html;
}

/**
 * Render the digest JSON and write the HTML file to disk.
 *
 * @param {object} digest
 * @param {object} [source]
 * @param {string} [outDir] - default "outputs"
 * @returns {Promise<string>} output path
 */
export async function renderFile(digest, source = {}, outDir = "outputs") {
  const html = await renderString(digest, source);
  await mkdir(outDir, { recursive: true });
  const base = outputFilenameBase(digest, source);
  const outPath = join(outDir, base + ".html");
  await writeFile(outPath, html, "utf8");
  return outPath;
}

function outputFilenameBase(digest, source = {}) {
  const author = sanitize((digest.authors && digest.authors[0]) || "Unknown");
  const year = extractYear(digest, source);
  const journal = venueAbbv(digest);
  const title = shortenedTitle(digest.title || "");
  const name = `${author}-${year}-${journal}-${title}`;
  return name.slice(0, 100);
}

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
  const words = beforeColon
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !stopwords.has(w));
  return words.slice(0, 4).join("_");
}

function extractYear(digest, source) {
  const m = String(digest.venue || "").match(/\b(19|20)\d{2}\b/);
  if (m) return m[0];
  const idM = String(digest.id || source.value || "").match(/(\d{2})\d{2}\.\d+/);
  if (idM) return `20${idM[1]}`;
  return String(new Date().getFullYear());
}

function venueAbbv(digest) {
  const v = String(digest.venue || "");
  if (/arxiv/i.test(v)) return "arXiv";
  const known = [
    "neurips", "icml", "iclr", "isscc", "jssc", "tcad", "cvpr", "iccv",
    "eccv", "acl", "emnlp", "naacl",
  ];
  const low = v.toLowerCase();
  for (const k of known) if (low.includes(k)) return k.charAt(0).toUpperCase() + k.slice(1);
  const tok = v.split(/\s+/)[0];
  return sanitize(tok) || "arXiv";
}

export { esc, outputFilenameBase, sanitize, shortenedTitle, extractYear, venueAbbv };
