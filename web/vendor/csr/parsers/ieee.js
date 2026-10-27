// Parser for ieeexplore.ieee.org document pages.
//
// Verified against a captured live document page (reference/ieee-page.html,
// document 10040932) -- the previous version's selectors were pure guesses
// and matched nothing, which is why "everything except the title disappeared".
// Real structure:
//  - Full text root: <div id="BodyWrapper"><div id="article"> ... </div></div>
//  - Abstract: <div class="abstract-text"> in the page header, outside
//    #article and not wrapped in a .section block -- sectionsFrom() never
//    sees it, so parse() prepends it as its own reading-mode section.
//  - Each section: <div class="section" id="sec1"><div class="header
//    article-hdr"><div class="kicker">SECTION I.</div><h2>Introduction</h2>
//    </div><p>...</p>...<div class="figure ...">...</div>...</div>
//  - Figure markup varies between article templates. Some templates expose
//    the image link, image, bold label and caption paragraph as siblings
//    rather than grouping them in a figure container.
//  - In-text citations are <a ref-type="bibr" anchor="ref1"
//    href="javascript:void()">[1]</a> -- note href is a dead javascript:
//    placeholder (stripped by common.js's href scheme guard); the real
//    target id is in the `anchor` attribute, not href.
//
// ⚠️ Known limitation: the reference list text itself is lazy-loaded into a
// collapsed "References" accordion panel only when a reader clicks to
// expand it (not present in the initial DOM, and IEEE's content differs by
// article/access level besides). We deliberately don't simulate that click
// (it would mean waiting on an async, publisher-controlled UI flow rather
// than reading page-local text), so citation hover peek on IEEE will
// typically show "Reference details not found on this page" even though the
// in-text numbering/body text itself renders correctly.
(function () {
  "use strict";
  const CSR = window.CSR;

  function detect(doc, ctx) {
    const { url } = CSR.util.ctx(doc, ctx);
    return url ? /(^|\.)ieeexplore\.ieee\.org$/.test(new URL(url).hostname) : false;
  }

  // Content-based detection for documents without a URL (paste / upload).
  function sniff(doc) {
    return !!CSR.util.genericArticleBody(doc, BODY_SELECTORS);
  }

  const BODY_SELECTORS = ["div#article", "div.document-text", "section.document-content"];
  const ABSTRACT_SELECTORS = ["div.abstract-text", "meta[name='description']"];
  const REF_LIST_SELECTORS = ["div.reference-container ol", "section.reference-container ol", "ol.references-list"];

  function tagCitations(root) {
    CSR.util.tagCitationRefs(root, 'a[ref-type="bibr"][anchor]', (a) => a.getAttribute("anchor"));
  }

  // IEEE does not wrap the abstract in a .section block, and on current
  // templates it sits outside #article entirely (in the page header), so
  // sectionsFrom() never sees it.
  //
  // The abstract is built as a first reading-mode section through the same
  // sanitization pipeline as body sections (clone -> strip heading ->
  // cloneClean) so that equations and the reading mark behave identically to
  // the rest of the article. cloneClean(root) surfaces root's *children* as
  // the content fragment, so the abstract flow is wrapped in a <p> block:
  // without that it would land as bare inline text under <main> and the
  // reading mark (which only units .csr-page p / li / blockquote / figcaption
  // / td and display math) could not reach it.
  function abstractSection(doc, base) {
    const src = doc.querySelector("div.abstract-text");
    if (!src) return null;
    const clone = src.cloneNode(true);
    // Drop the publisher's own "Abstract:" heading; render.js prints the
    // section title (<h2 id="abstract">) itself.
    clone.querySelectorAll("h2, h3").forEach((h) => {
      if (/^\s*abstract\s*:?\s*$/i.test(CSR.util.textContentOf(h))) h.remove();
    });
    groupLooseFigures(clone);
    tagCitations(clone);
    const block = doc.createElement("div");
    const p = doc.createElement("p");
    while (clone.firstChild) p.appendChild(clone.firstChild);
    block.appendChild(p);
    return {
      id: "abstract",
      title: "Abstract",
      content: CSR.util.cloneClean(block, { baseURI: base }),
    };
  }

  // Abstract text (string only) for the no-full-text fallback. Equations
  // cannot be reconstructed from a meta tag, so plain text is the best
  // available there -- still wrapped as a <p> block in parse() so the
  // reading mark can reach it.
  function abstractText(doc) {
    for (const sel of ABSTRACT_SELECTORS) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = el.tagName === "META" ? el.getAttribute("content") : CSR.util.textContentOf(el);
      if (text) return text;
    }
    return null;
  }

  function groupLooseFigures(root) {
    // The sanitizer unwraps <div>s, so IEEE's <div class="figure"> would
    // otherwise collapse into loose <a>/<img>/<b>/<p> siblings. Convert the
    // containers into real <figure>/<figcaption> elements first.
    const doc = root.ownerDocument;
    root.querySelectorAll("div.figure").forEach((div) => {
      const img = div.querySelector("img");
      if (!img) return;
      const figure = doc.createElement("figure");
      if (div.id) figure.id = div.id;

      const wrap = div.querySelector(".img-wrap") || img;
      const link = img.closest("a");
      figure.appendChild(link && wrap.contains(link) ? link : img);

      const capSrc = div.querySelector(".figcaption");
      if (capSrc) {
        const caption = doc.createElement("figcaption");
        while (capSrc.firstChild) caption.appendChild(capSrc.firstChild);
        figure.appendChild(caption);
      }
      div.replaceWith(figure);
    });
  }

  function buildBibliography(doc, base) {
    const list = CSR.util.genericBibliography(doc, REF_LIST_SELECTORS);
    const map = {};
    if (!list) return map;
    list.querySelectorAll("li[id]").forEach((item) => {
      const clone = item.cloneNode(true);
      const frag = CSR.util.cloneClean(clone, { baseURI: base });
      map[item.id] = { id: item.id, text: CSR.util.textContentOf(frag) };
    });
    return map;
  }

  function sectionsFrom(doc, body, base) {
    const out = [];
    const sections = Array.from(body.querySelectorAll(".section"));
    if (!sections.length) {
      // Fall back to a flat single block in case a different IEEE article
      // template doesn't use .section wrappers.
      const clone = CSR.util.cloneWithStyles(body);
      groupLooseFigures(clone);
      tagCitations(clone);
      out.push({ id: "body", title: "", content: CSR.util.cloneClean(clone, { baseURI: base }) });
      return out;
    }
    sections.forEach((sec) => {
      if (sec.parentElement.closest(".section")) return; // nested subsection, handled with its parent
      const titleEl = sec.querySelector(":scope > .header h2, :scope > .header h3");
      const title = titleEl ? CSR.util.textContentOf(titleEl) : "";
      const clone = CSR.util.cloneWithStyles(sec);
      const cloneHeader = clone.querySelector(":scope > .header");
      if (cloneHeader) cloneHeader.remove();
      groupLooseFigures(clone);
      tagCitations(clone);
      out.push({
        id: sec.id || CSR.util.slugify(title),
        title,
        content: CSR.util.cloneClean(clone, { baseURI: base }),
      });
    });
    return out;
  }

  function parse(doc, ctx) {
    doc = doc || document;
    const { url, base } = CSR.util.ctx(doc, ctx);
    const m = CSR.util.citationMeta(doc);
    const body = CSR.util.genericArticleBody(doc, BODY_SELECTORS);
    let sections;
    if (body) {
      sections = sectionsFrom(doc, body, base);
      // The abstract is not inside a .section block, so sectionsFrom()
      // never sees it -- prepend it as its own reading-mode section.
      const absSec = abstractSection(doc, base);
      if (absSec) sections.unshift(absSec);
    } else {
      // Full text unavailable: fall back to just the abstract so the toggle
      // still produces something useful rather than silently doing nothing.
      const abs = abstractText(doc);
      if (!abs) return null;
      const block = doc.createElement("div");
      const p = doc.createElement("p");
      p.textContent = abs;
      block.appendChild(p);
      sections = [{ id: "abstract", title: "Abstract", content: CSR.util.cloneClean(block, { baseURI: base }) }];
    }

    const venueParts = [];
    if (m.journal) venueParts.push(m.journal);
    if (m.date) venueParts.push(m.date);
    if (m.doi) venueParts.push("doi:" + m.doi);

    return {
      site: "ieee",
      title: m.title || CSR.util.textContentOf(doc.querySelector("h1")) || "Untitled",
      authors: m.authors.length ? m.authors.join(", ") : null,
      venueLine: venueParts.join(" \u00b7 "),
      sourceUrl: url,
      ids: { arxiv: null, doi: m.doi || null },
      sections,
      bibliography: buildBibliography(doc, base),
    };
  }

  CSR.parsers.push({ id: "ieee", detect, parse, sniff });
})();
