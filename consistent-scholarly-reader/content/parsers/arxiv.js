// Parser for arXiv's generated-HTML papers (arxiv.org/html/... and the
// ar5iv mirror), which are produced by LaTeXML and use its stable `ltx_*`
// class naming (verified against a live LaTeXML output page).
(function () {
  "use strict";
  const CSR = window.CSR;

  function detect(doc, ctx) {
    const { url } = CSR.util.ctx(doc, ctx);
    return url ? /^https?:\/\/(arxiv\.org|ar5iv\.labs\.arxiv\.org)\//.test(url) : false;
  }

  function tagCitations(root) {
    CSR.util.tagCitationRefs(root, 'a[href^="#bib"]', (a) => a.getAttribute("href").slice(1));
  }

  // LaTeXML-specific cleanup applied to every clone before sanitizing:
  //  - .ltx_tag_item is a manually-rendered bullet/number label ("•", "1.")
  //    that duplicates the native <ul>/<ol> marker the browser already
  //    draws, causing a visibly doubled bullet/number.
  //  - .ltx_listing_data is a hidden-text "download raw listing" link (a
  //    base64 data: URI) that has no business being visible content.
  //  Tables, listings and algorithms are preserved as-is by the sanitizer.
  function stripLatexmlArtifacts(clone) {
    clone.querySelectorAll(".ltx_tag_item, .ltx_listing_data").forEach((n) => n.remove());
  }

  function buildBibliography(doc, base) {
    const list = doc.querySelector(".ltx_biblist, .ltx_bibliography");
    const map = {};
    if (!list) return map;
    list.querySelectorAll(".ltx_bibitem[id]").forEach((item) => {
      const clone = item.cloneNode(true);
      clone.querySelectorAll(".ltx_tag").forEach((n) => n.remove());
      const frag = CSR.util.cloneClean(clone, { baseURI: base });
      map[item.id] = { id: item.id, text: CSR.util.textContentOf(frag) };
    });
    return map;
  }

  function sectionsFrom(doc, article, base) {
    const out = [];

    const abstract = article.querySelector(".ltx_abstract");
    if (abstract) {
      const clone = CSR.util.cloneWithStyles(abstract);
      clone.querySelectorAll(":scope > .ltx_title").forEach((n) => n.remove());
      stripLatexmlArtifacts(clone);
      tagCitations(clone);
      out.push({
        id: "abstract",
        title: "Abstract",
        content: CSR.util.cloneClean(clone, { baseURI: base }),
      });
    }

    article.querySelectorAll(".ltx_section").forEach((sec) => {
      // Only top-level sections: subsections are nested inside and copied
      // along with their parent, so skip anything already inside a section.
      if (sec.parentElement.closest(".ltx_section")) return;
      const titleEl = sec.querySelector(":scope > .ltx_title");
      const title = titleEl ? CSR.util.textContentOf(titleEl) : "";
      const clone = CSR.util.cloneWithStyles(sec);
      const cloneTitle = clone.querySelector(":scope > .ltx_title");
      if (cloneTitle) cloneTitle.remove();
      stripLatexmlArtifacts(clone);
      tagCitations(clone);
      out.push({
        id: sec.id || CSR.util.slugify(title),
        title,
        content: CSR.util.cloneClean(clone, { baseURI: base }),
      });
    });

    const biblio = article.querySelector(".ltx_bibliography");
    if (biblio) {
      const clone = CSR.util.cloneWithStyles(biblio);
      const cloneTitle = clone.querySelector(".ltx_title");
      if (cloneTitle) cloneTitle.remove();
      stripLatexmlArtifacts(clone);
      out.push({
        id: "references",
        title: "References",
        content: CSR.util.cloneClean(clone, { baseURI: base }),
      });
    }

    return out;
  }

  // Content-based detection for documents without a URL (paste / upload).
  function sniff(doc) {
    return !!doc.querySelector(".ltx_document");
  }

  function parse(doc, ctx) {
    doc = doc || document;
    const { url, base } = CSR.util.ctx(doc, ctx);
    const article = doc.querySelector(".ltx_document");
    if (!article) return null; // e.g. arxiv.org/abs/* has no full-text body

    const m = CSR.util.citationMeta(doc);
    const titleEl = article.querySelector(".ltx_title.ltx_title_document, h1.ltx_title");
    const title = m.title || (titleEl ? CSR.util.textContentOf(titleEl) : CSR.util.textContentOf(doc.querySelector("title")));

    const authorEls = article.querySelectorAll(".ltx_personname");
    const authors = m.authors.length
      ? m.authors.join(", ")
      : authorEls.length
      ? Array.from(authorEls).map((e) => CSR.util.textContentOf(e)).join(", ")
      : null;

    const venueParts = [];
    const arxivId = m.arxivId || (url ? (url.match(/(\d{4}\.\d{4,5})(v\d+)?/) || [])[0] : null);
    if (arxivId) venueParts.push("arXiv:" + arxivId);
    if (m.date) venueParts.push(m.date);

    return {
      site: "arxiv",
      title: title || "Untitled",
      authors,
      venueLine: venueParts.join(" \u00b7 "),
      sourceUrl: url,
      ids: { arxiv: arxivId || null, doi: m.doi || null },
      sections: sectionsFrom(doc, article, base),
      bibliography: buildBibliography(doc, base),
    };
  }

  CSR.parsers.push({ id: "arxiv", detect, parse, sniff });
})();
