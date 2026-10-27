/**
 * Agent B — render.
 *
 * Renders a `Digest` into the self-contained `assets/template.html` page
 * using the shared `scholarly-reader` module for document structure, layout,
 * reading mark, and table of contents.
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

// Import scholarly-reader exports (copied to web/assets/scholarly-reader/ by build)
import {
  CSS,
  protectMath,
  restoreMath,
  buildDocument,
  mountLayout,
  ensureFonts,
  createReadingMark,
} from "../../assets/scholarly-reader/scholarly-reader.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c] || c);
}

/** Escape for JavaScript string literal (used for template script placeholders). */
function escJs(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

/* ---------------------------------------------------------------- environment detection */

// Detect whether we have browser-native DOMParser/XMLSerializer (browser or jsdom).
// In pure Node without jsdom, both are undefined.
function hasNativeParser() {
  return (
    typeof DOMParser !== "undefined" ||
    (typeof window !== "undefined" && window.DOMParser)
  );
}

function hasNativeSerializer() {
  return (
    typeof XMLSerializer !== "undefined" ||
    (typeof window !== "undefined" && window.XMLSerializer)
  );
}

function getParser() {
  return new (typeof DOMParser !== "undefined" ? DOMParser : window.DOMParser)();
}

function getSerializer() {
  return new (typeof XMLSerializer !== "undefined" ? XMLSerializer : window.XMLSerializer)();
}

// Lazy template URL — avoids module-level access to window.location (fails in Node).
function getTemplateUrl() {
  return new URL("assets/template.html", window.location.href).href;
}

/* ---------------------------------------------------------------- sanitize */

// DOMPurify instance for sanitizeHtml (uses global window from shim or browser).
// Created lazily on first use so window is available.
let DOMPurify = null;
function getDOMPurify() {
  if (!DOMPurify) {
    DOMPurify = createDOMPurify(globalThis.window);
  }
  return DOMPurify;
}

/** DOMPurify with html + svg profiles; allow figure anchors and math tags. */
function sanitizeHtml(html, { svg = false } = {}) {
  const config = {
    USE_PROFILES: { html: true, ...(svg ? { svg: true } : {}) },
    ADD_TAGS: ["figure", "figcaption", "mjx-container", "math"],
    ADD_ATTR: ["data-n", "data-a"],
    FORCE_BODY: false,
  };
  return getDOMPurify().sanitize(String(html || ""), config);
}

/**
 * Render markdown with math protection (used by tests).
 * protectMath -> marked.parse -> restoreMath
 */
function renderContent(src) {
  const { text, blocks } = protectMath(src);
  const html = marked.parse(text);
  return restoreMath(html, blocks);
}

/* ---------------------------------------------------------------- model conversion */

/**
 * Convert paper-digest Digest model to scholarly-reader model.
 */
function toScholarlyModel(digest, ctx = {}) {
  const figures = Array.isArray(ctx.figures) ? ctx.figures : [];
  const meta = digest.meta || {};
  const sections = digest.sections || [];

  // Build header - map paper-digest meta to scholarly-reader header
  // Include full "venue · id · what-read" in kicker for source link compatibility
  // Use actual middot character (not entity) to avoid double-encoding via textContent
  const headerLine = [meta.venue, meta.id, `read: ${meta.whatRead}`].filter(Boolean).join(" · ");
  const header = {
    title: meta.title || "",
    authors: Array.isArray(meta.authors) ? meta.authors.join(", ") : String(meta.authors || ""),
    kicker: headerLine || "",
    kickerHref: ctx.baseUrl || null,
    verdict: meta.verdict ? { text: meta.verdict, badge: { tone: "accent", label: `${meta.overallConfidence || 0}%` } } : null,
  };

  // Convert sections
  const srSections = sections.map((s) => {
    const blocks = [];

    switch (s.id) {
      case "mot":
      case "diff":
      case "core":
      case "bg":
      case "src":
        if (s.content) {
          blocks.push({ type: "markdown", text: s.content });
        }
        break;

      case "eval":
        if (s.content) {
          const items = (s.content || "")
            .split(/\n\n+/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => ({ markdown: p }));
          blocks.push({ type: "items", items });
        }
        break;

      case "icymi":
        if (s.entries) {
          const items = s.entries.map((e) => ({
            markdown: esc(e.text),
            badge: e.tag ? { tone: e.tag, label: { pos: "+", neg: "−", neu: "·" }[e.tag] || "·" } : null,
          }));
          blocks.push({ type: "items", items });
        }
        break;

      case "judge":
        if (s.rows) {
          blocks.push({
            type: "table",
            head: [{ markdown: "Question" }, { markdown: "Answer" }, { markdown: "Conf." }],
            rows: s.rows.map((r) => [
              { markdown: esc(r.question) },
              { markdown: esc(r.answer) },
              { markdown: r.conf == null ? "" : String(r.conf) + "%" },
            ]),
          });
        }
        break;

      default:
        if (s.content) {
          blocks.push({ type: "markdown", text: s.content });
        }
    }

    return {
      id: s.id,
      title: s.title,
      badge: s.confidence != null ? { tone: "accent", label: `${s.confidence}%` } : null,
      blocks,
    };
  });

  // Convert figures
  const srFigures = figures.map((f, i) => ({
    n: f.n != null ? f.n : i + 1,
    dataA: f.dataA,
    caption: f.caption,
    url: f.url,
    svg: f.svg,
  }));

  return { header, sections: srSections, figures: srFigures };
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
  const meta = digest.meta || {};

  // Figure map for template's client-side fallback
  const figureMap = {};
  figures.forEach((f, i) => {
    const n = String(f.n != null ? f.n : i + 1);
    if (f.url) figureMap[n] = f.url;
  });

  // Convert to scholarly-reader model
  const model = toScholarlyModel(digest, ctx);

  // Load template
  const tmpl = await loadTemplate();

  // Parse template to DOM (browser-native DOMParser or jsdom in tests)
  let doc;
  let docWindow;
  if (hasNativeParser()) {
    // Browser environment or jsdom
    const parser = getParser();
    doc = parser.parseFromString(tmpl, "text/html");
    docWindow = doc.defaultView || window;
  } else {
    // Node.js test environment without jsdom DOMParser
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(tmpl, { contentType: "text/html", url: "http://localhost/" });
    doc = dom.window.document;
    docWindow = dom.window;
    // Shim globalThis.window for DOMPurify and scholarly-reader in pure Node tests
    globalThis.window = docWindow;
  }

  // Save the script tags from the template body (they contain BASE/MAP and client-side logic)
  const templateScripts = Array.from(doc.body.querySelectorAll("script")).map(s => s.cloneNode(true));

  // Inject scholarly-reader CSS into the document head
  const styleEl = doc.createElement("style");
  styleEl.id = "sr-styles";
  styleEl.textContent = CSS;
  doc.head.insertBefore(styleEl, doc.head.firstChild);

  // Ensure fonts are loaded
  ensureFonts(doc);

  // Create DOMPurify for this document's window
  const DOMPurifyLocal = createDOMPurify(docWindow);

  // Sanitizer function for scholarly-reader
  const sanitize = (html, { svg = false } = {}) => {
    const config = {
      USE_PROFILES: { html: true, ...(svg ? { svg: true } : {}) },
      ADD_TAGS: ["figure", "figcaption", "mjx-container", "math"],
      ADD_ATTR: ["data-n", "data-a"],
      FORCE_BODY: false,
    };
    return DOMPurifyLocal.sanitize(String(html || ""), config);
  };

  // Markdown converter for scholarly-reader
  const markdown = (src) => {
    const { text, blocks } = protectMath(src);
    const html = marked.parse(text);
    return restoreMath(html, blocks);
  };

  // Build the document structure using scholarly-reader
  const { root, page, main, toc, tocButton } = buildDocument(model, {
    document: doc,
    markdown,
    sanitize,
  });

  // Replace the template's body content with the scholarly-reader structure
  const body = doc.body;
  body.innerHTML = "";
  body.appendChild(root);

  // Re-append the template scripts (with BASE/MAP placeholders replaced)
  for (const script of templateScripts) {
    if (script.textContent.includes("{{BASE}}") || script.textContent.includes("{{MAP}}")) {
      script.textContent = script.textContent
        .split("{{BASE}}").join(escJs(base))
        .split("{{MAP}}").join(JSON.stringify(figureMap));
    }
    body.appendChild(script);
  }

  // Update title
  const titleEl = doc.querySelector("title");
  if (titleEl) titleEl.textContent = `Digest: ${esc(meta.title || "")}`;

  // Update the kicker link (source URL) in the scholarly-reader header
  const kickerLink = doc.querySelector(".sr-kicker-link");
  if (kickerLink && ctx.baseUrl) {
    kickerLink.setAttribute("href", ctx.baseUrl);
    kickerLink.style.cssText = "color:inherit;text-decoration:underline;cursor:pointer";
  }

  // Serialize to HTML string (avoid XMLSerializer which escapes script content)
  // Prepend DOCTYPE if present, since outerHTML/serializeDocument don't include it
  function withDoctype(html) {
    if (!doc.doctype) return html;
    const dt = doc.doctype;
    let doctypeStr = "<!DOCTYPE " + dt.name;
    if (dt.publicId) doctypeStr += ' PUBLIC "' + dt.publicId + '"';
    if (dt.systemId) doctypeStr += ' "' + dt.systemId + '"';
    doctypeStr += ">";
    return doctypeStr + html;
  }

  if (hasNativeSerializer()) {
    // Browser environment or jsdom - use outerHTML for proper HTML serialization
    return withDoctype(doc.documentElement.outerHTML);
  } else {
    // Node.js test environment (jsdom) - use static serializeDocument
    const { serializeDocument } = await import("jsdom");
    return withDoctype(serializeDocument(doc));
  }
}

async function loadTemplate() {
  if (!templateCache) {
    const resp = await fetch(getTemplateUrl());
    if (!resp.ok) throw new Error(`Failed to load template: ${resp.status} ${resp.statusText}`);
    templateCache = await resp.text();
  }
  return templateCache;
}

let templateCache = null;

export { esc, sanitizeHtml, renderContent };