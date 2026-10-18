// Shared namespace + DOM sanitizer used by every site parser and the renderer.
// Classic (non-module) script: everything hangs off window.CSR so later-loaded
// content script files in the manifest's content_scripts list can see it.
(function () {
  "use strict";

  const CSR = (window.CSR = window.CSR || {});
  CSR.parsers = CSR.parsers || [];
  CSR.util = CSR.util || {};

  // Tags kept as-is (attributes still filtered per ALLOWED_ATTRS).
  const ALLOWED_TAGS = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "figure", "figcaption", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "blockquote", "a", "span", "strong", "b", "em", "i", "sup", "sub",
    "code", "pre", "br", "hr",
  ]);

  // Tags whose entire subtree is copied verbatim (math typesetting output is
  // too structurally specific to sanitize node-by-node).
  const VERBATIM_TAGS = new Set(["math", "mjx-container", "svg"]);

  // Tags dropped entirely, including their text/children (chrome, scripts,
  // interactive widgets, publisher nav/ads that may be nested in content).
  const DROP_TAGS = new Set([
    "script", "style", "noscript", "button", "nav", "form", "iframe",
    "svg", // only kept verbatim when inside VERBATIM_TAGS check above
    "foreignObject", // never trust embedded HTML inside an SVG figure
    "input", "select", "textarea", "dialog", "template",
  ]);

  const ALLOWED_ATTRS = {
    a: ["href", "data-csr-cite-ref", "data-csr-cite-text"],
    img: ["src", "alt", "width", "height"],
    object: ["data", "type", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    "*": ["id"],
  };

  // Schemes allowed on an <a href>; anything else (javascript:, vbscript:,
  // etc. -- seen verbatim in some publishers' own markup, e.g. IEEE's
  // `href="javascript:void()"` citation placeholders) is dropped rather than
  // preserved, since a clicked link executing script would be a real risk.
  const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "data:"]);

  function absUrl(url, base) {
    if (!url) return url;
    // Fragment-only references (e.g. <use href="#id">) must stay untouched:
    // resolving them against the page URL turns them into absolute URLs and
    // breaks the reference. Callers pass the document base for everything else.
    if (url.startsWith("#")) return url;
    try {
      const resolved = new URL(url, base || document.baseURI);
      if (!SAFE_HREF_SCHEMES.has(resolved.protocol)) return null;
      return resolved.href;
    } catch (e) {
      return null;
    }
  }
  CSR.util.absUrl = absUrl;

  /**
   * Resolve a document's URL / host / base URL from an explicit context when
   * one is provided, falling back to the live document, then to safe nulls.
   *
   * A `DOMParser` document has `location === null` and `baseURI` equal to the
   * app's own URL, so never resolve relative URLs against it unconditionally.
   *
   * @param {Document} doc
   * @param {object} [ctx] - {url?, host?, base?}
   * @returns {{url:string|null, host:string|null, base:string}}
   */
  function ctx(doc, ctx) {
    const url =
      (ctx && ctx.url != null) ? String(ctx.url) :
      (doc && doc.location && doc.location.href) ? String(doc.location.href) :
      null;
    const host = url ? (new URL(url).hostname) : null;
    // When there is no URL (paste / upload of a detached document) resolve
    // relative references against about:blank so they are dropped rather than
    // silently mis-resolved against the app's own origin (doc.baseURI of a
    // DOMParser document is the app URL -- a correctness trap).
    const base = url ? url : "about:blank";
    return { url, host, base };
  }
  CSR.util.ctx = ctx;

  function slugify(text, fallback) {
    const base = (text || "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return base || fallback || ("s" + Math.random().toString(36).slice(2, 8));
  }
  CSR.util.slugify = slugify;

  function copyAllowedAttrs(src, dest, baseURI) {
    const tag = dest.tagName.toLowerCase();
    const allowed = (ALLOWED_ATTRS[tag] || []).concat(ALLOWED_ATTRS["*"]);
    for (const name of allowed) {
      if (!src.hasAttribute(name)) continue;
      let val = src.getAttribute(name);
      if (name === "href" || name === "src" || name === "data") {
        val = absUrl(val, baseURI);
        if (val === null) continue; // unsafe/unresolvable URL -- drop the attribute
      }
      dest.setAttribute(name, val);
    }
  }

  /**
   * Clone a DOM subtree into a sanitized DocumentFragment: only ALLOWED_TAGS
   * survive as elements (others are unwrapped, keeping their children, unless
   * in DROP_TAGS in which case the whole subtree is discarded). VERBATIM_TAGS
   * (math/mjx-container) are deep-cloned untouched.
   */
  function cloneClean(root, opts) {
    const baseURI = (opts && opts.baseURI) || document.baseURI;
    const frag = document.createDocumentFragment();
    for (const child of Array.from(root.childNodes)) {
      const cleaned = cleanNode(child, baseURI);
      if (cleaned) frag.appendChild(cleaned);
    }
    return frag;
  }
  CSR.util.cloneClean = cloneClean;

  // Blocks reproduced as-is (structure + classes) because re-sanitizing them
  // node-by-node breaks layout: tables (which LaTeXML also uses to lay out
  // equations), code listings and pseudocode/algorithm figures.
  const PRESERVED_CLASSES = ["ltx_listing", "ltx_float_algorithm", "ltx_algorithm"];

  // LaTeXML expresses inline formatting as classes on <span class="ltx_text ...">
  // rather than semantic tags. Classes are stripped by copyAllowedAttrs, so map
  // them onto allowed semantic tags to keep the formatting.
  const FORMAT_CLASS_TAGS = [
    ["ltx_font_typewriter", "code"],
    ["ltx_font_bold", "strong"],
    ["ltx_font_italic", "em"],
  ];

  function wrapFormatting(node, out) {
    // Only spans: <em>/<strong>/<code> already carry their meaning in the tag.
    if (node.tagName.toLowerCase() !== "span") return out;
    let result = out;
    for (const [cls, wrapTag] of FORMAT_CLASS_TAGS) {
      if (node.classList.contains(cls)) {
        const w = document.createElement(wrapTag);
        w.appendChild(result);
        result = w;
      }
    }
    return result;
  }

  function isPreservedBlock(node, tag) {
    if (tag === "table") return true;
    return PRESERVED_CLASSES.some((c) => node.classList.contains(c));
  }

  // Computed properties baked into preserved blocks, so they keep their
  // publisher look without needing the publisher's stylesheet.
  const SNAPSHOT_PROPS = [
    "display", "width", "min-width", "max-width", "height", "box-sizing",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-top-style", "border-top-color",
    "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color",
    "border-collapse", "border-spacing", "table-layout", "caption-side",
    "text-align", "vertical-align", "white-space", "line-height",
    "font-family", "font-size", "font-style", "font-weight", "color",
    "text-decoration-line", "text-indent", "background-color",
    "float", "overflow-x", "position", "top", "left",
  ];

  const SNAPSHOT_SELECTOR = "table, " + PRESERVED_CLASSES.map((c) => "." + c).join(", ");

  function snapshotPair(src, dst) {
    if (src.namespaceURI === "http://www.w3.org/2000/svg") return;
    const cs = getComputedStyle(src);
    let css = "";
    for (const p of SNAPSHOT_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) css += p + ":" + v + ";";
    }
    dst.setAttribute("style", css);
    const sc = src.children, dc = dst.children;
    for (let i = 0; i < sc.length && i < dc.length; i++) snapshotPair(sc[i], dc[i]);
  }

  /**
   * Deep clone of a live element in which tables/listings/algorithms carry
   * their computed styles inline. Must be called on an element attached to
   * the live page (detached clones have no computed style), and before any
   * nodes are removed from the clone, since source/clone are walked in step.
   */
  function cloneWithStyles(root) {
    const clone = root.cloneNode(true);
    // Detached clones (e.g. from a parsed document) have no computed style:
    // return the plain clone rather than calling getComputedStyle, which is
    // meaningless off the live page.
    if (!root.isConnected) return clone;
    const src = Array.from(root.querySelectorAll(SNAPSHOT_SELECTOR));
    const dst = Array.from(clone.querySelectorAll(SNAPSHOT_SELECTOR));
    for (let i = 0; i < src.length && i < dst.length; i++) snapshotPair(src[i], dst[i]);
    return clone;
  }
  CSR.util.cloneWithStyles = cloneWithStyles;

  // Deep clone that still strips active content: drop DROP_TAGS subtrees,
  // event-handler/style attributes, and unsafe URLs.
  function cloneVerbatimSafe(node, baseURI) {
    const copy = node.cloneNode(true);
    const els = [copy, ...copy.querySelectorAll("*")];
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      if (el !== copy && DROP_TAGS.has(tag) && !el.closest("math, mjx-container")) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (name === "href" || name === "src" || name === "data" || name === "xlink:href") {
          const val = absUrl(attr.value, baseURI);
          if (val === null) el.removeAttribute(attr.name);
          else el.setAttribute(attr.name, val);
        }
      }
    }
    return copy;
  }

  function cleanNode(node, baseURI) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.nodeValue);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();

    if (VERBATIM_TAGS.has(tag)) {
      return cloneVerbatimSafe(node, baseURI);
    }
    if (isPreservedBlock(node, tag)) {
      return cloneVerbatimSafe(node, baseURI);
    }
    if (DROP_TAGS.has(tag)) {
      return null;
    }
    if (tag === "img") {
      const out = document.createElement("img");
      copyAllowedAttrs(node, out, baseURI);
      out.loading = "lazy";
      return out;
    }
    if (tag === "object") {
      // Vector-graphics figures embedded as <object type="image/svg+xml"
      // data="...">; unlike <img> these have no fallback text/child content
      // of their own, so without this special case they sanitize down to an
      // empty element and get dropped entirely by the empty-element check
      // below (this was the "figures missing" bug).
      if (!node.hasAttribute("data")) return null;
      const out = document.createElement("object");
      copyAllowedAttrs(node, out, baseURI);
      if (!out.hasAttribute("data")) return null; // data: URL failed to resolve/was unsafe
      return out;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: keep children (e.g. publisher <div>/<section> wrappers)
      // so content isn't lost just because the wrapper itself is disallowed.
      const frag = document.createDocumentFragment();
      for (const child of Array.from(node.childNodes)) {
        const cleaned = cleanNode(child, baseURI);
        if (cleaned) frag.appendChild(cleaned);
      }
      return frag.childNodes.length ? frag : null;
    }

    const out = document.createElement(tag);
    copyAllowedAttrs(node, out, baseURI);
    for (const child of Array.from(node.childNodes)) {
      const cleaned = cleanNode(child, baseURI);
      if (cleaned) out.appendChild(cleaned);
    }
    // Drop elements that sanitized down to nothing (e.g. an icon <a> with
    // only an <svg> child, which was stripped as DROP_TAGS).
    if (!out.childNodes.length && tag !== "br" && tag !== "hr" && tag !== "img") {
      return null;
    }
    return wrapFormatting(node, out);   // was: return out;
  }

  /**
   * Tags in-text citation links with a `data-csr-cite-ref` id (so
   * citationPeek.js can resolve it against the page's parsed bibliography
   * map) and, when the publisher already embeds the full reference text
   * inline (e.g. Nature's `title="..."` attribute on citation anchors),
   * captures that into `data-csr-cite-text` so peek can show it directly
   * without needing the bibliography list to parse correctly at all.
   *
   * @param {Element} root - subtree to scan (already detached/cloned).
   * @param {string} selector - CSS selector matching citation <a> elements.
   * @param {(a: Element) => string|null} idFromAnchor - extracts the
   *   bibliography entry id this anchor points to, or null if none.
   */
  function tagCitationRefs(root, selector, idFromAnchor) {
    root.querySelectorAll(selector).forEach((a) => {
      const id = idFromAnchor(a);
      if (id) a.setAttribute("data-csr-cite-ref", id);
      const inline = (a.getAttribute("title") || "").trim();
      if (inline.length > 15) a.setAttribute("data-csr-cite-text", inline);
    });
  }
  CSR.util.tagCitationRefs = tagCitationRefs;

  function textContentOf(node) {
    return (node && node.textContent || "").replace(/\s+/g, " ").trim();
  }
  CSR.util.textContentOf = textContentOf;

  /** First matching meta[name=...] or meta[property=...] content value. */
  function meta(doc, names) {
    for (const name of names) {
      const el =
        doc.querySelector(`meta[name="${name}"]`) ||
        doc.querySelector(`meta[property="${name}"]`);
      if (el && el.getAttribute("content")) return el.getAttribute("content").trim();
    }
    return null;
  }
  CSR.util.meta = meta;

  function metaAll(doc, names) {
    const out = [];
    for (const name of names) {
      doc
        .querySelectorAll(`meta[name="${name}"], meta[property="${name}"]`)
        .forEach((el) => {
          const v = el.getAttribute("content");
          if (v && v.trim()) out.push(v.trim());
        });
    }
    return out;
  }
  CSR.util.metaAll = metaAll;

  /**
   * Highwire/Google-Scholar "citation_*" meta tags are the de-facto standard
   * emitted by most scholarly publishers (incl. arXiv's /abs/ page, IEEE,
   * Nature, ACM, Science). Use them as the primary metadata source; callers
   * should fall back to DOM scraping only for fields that come back empty.
   */
  function citationMeta(doc) {
    const title = meta(doc, ["citation_title", "og:title"]);
    const authors = metaAll(doc, ["citation_author"]);
    const date = meta(doc, ["citation_publication_date", "citation_date", "citation_online_date"]);
    const journal = meta(doc, ["citation_journal_title", "citation_conference_title"]);
    const doi = meta(doc, ["citation_doi"]);
    const arxivId = meta(doc, ["citation_arxiv_id"]);
    return { title, authors, date, journal, doi, arxivId };
  }
  CSR.util.citationMeta = citationMeta;

  /**
   * Last-resort body extraction when a site-specific selector list comes up
   * empty: try common wrapper selectors, else pick the element under
   * <main>/<article>/[role=main] with the most paragraph text.
   */
  function genericArticleBody(doc, candidateSelectors) {
    for (const sel of candidateSelectors || []) {
      const el = doc.querySelector(sel);
      if (el && textContentOf(el).length > 200) return el;
    }
    const roots = doc.querySelectorAll("article, main, [role=main]");
    let best = null;
    let bestLen = 0;
    roots.forEach((el) => {
      const len = textContentOf(el).length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    });
    return bestLen > 200 ? best : null;
  }
  CSR.util.genericArticleBody = genericArticleBody;

  /**
   * Heuristic bibliography-list finder: a list/container element whose
   * children's ids are referenced by in-text citation links in `scope`.
   */
  function genericBibliography(doc, candidateSelectors) {
    for (const sel of candidateSelectors || []) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
  CSR.util.genericBibliography = genericBibliography;

  /** Remove all elements matching any of `selectors` from `root` in place. */
  function stripSelectors(root, selectors) {
    if (!selectors || !selectors.length) return;
    root.querySelectorAll(selectors.join(",")).forEach((el) => el.remove());
  }
  CSR.util.stripSelectors = stripSelectors;
})();
