// Parser for nature.com articles.
//
// Verified against a captured live article page (reference/nature-citations-bad.html):
//  - div.c-article-body wraps the sections.
//  - Each section is <section aria-labelledby="X" data-title="..."> containing
//    <div class="c-article-section"><h2 class="c-article-section__title" id="X">...
//  - In-text citation anchors look like:
//      <sup><a data-track-action="reference anchor" title="<full citation text>"
//            href="/articles/<slug>#ref-CR6">6</a></sup>
//    Nature conveniently embeds the *full* reference text in the anchor's own
//    `title` attribute, which CSR.util.tagCitationRefs captures automatically
//    (this is what actually fixes "citation hover doesn't work" -- our
//    sanitizer was also stripping that title attribute before, see common.js).
//  - The reference list itself is <ol class="c-article-references"><li
//    class="c-article-references__item"><p class="c-article-references__text"
//    id="ref-CR1">...</p>...</li></ol> -- note the id lives on the inner <p>,
//    not the <li> (a first version of this parser looked for `li[id]` and
//    silently built an empty bibliography map, the other half of that bug).
(function () {
  "use strict";
  const CSR = window.CSR;

  function detect(doc, ctx) {
    const { url } = CSR.util.ctx(doc, ctx);
    return url ? /(^|\.)nature\.com$/.test(new URL(url).hostname) : false;
  }

  // Content-based detection for documents without a URL (paste / upload).
  function sniff(doc) {
    return !!CSR.util.genericArticleBody(doc, BODY_SELECTORS);
  }

  const BODY_SELECTORS = ["div.c-article-body", "div[data-component='article-body']"];
  const REF_LIST_SELECTORS = ["ol.c-article-references", "div.c-article-references"];
  const CITE_SELECTOR = 'a[href*="#ref-CR"], a[href*="#Bib"], a[href^="#CR"]';

  // Non-article-content widgets that Nature's CMS interleaves directly
  // inside the same body container as real sections (there's no easy DOM
  // position to distinguish them other than by their own class/aria-label).
  const NON_CONTENT_SECTION_SELECTOR =
    "section.c-article-recommendations, section.app-explore-related-subjects, section[aria-labelledby='inline-recommendations']";

  function tagCitations(root) {
    CSR.util.tagCitationRefs(root, CITE_SELECTOR, (a) => {
      const href = a.getAttribute("href") || "";
      const i = href.indexOf("#");
      return i >= 0 ? href.slice(i + 1) : null;
    });
  }

  function buildBibliography(doc, base) {
    const list = CSR.util.genericBibliography(doc, REF_LIST_SELECTORS);
    const map = {};
    if (!list) return map;
    list.querySelectorAll(".c-article-references__text[id], li[id]").forEach((item) => {
      const clone = item.cloneNode(true);
      const frag = CSR.util.cloneClean(clone, { baseURI: base });
      map[item.id] = { id: item.id, text: CSR.util.textContentOf(frag) };
    });
    return map;
  }

  function sectionsFrom(doc, body, base) {
    const out = [];
    const sections = Array.from(body.querySelectorAll("section")).filter(
      (sec) => !sec.matches(NON_CONTENT_SECTION_SELECTOR)
    );
    if (sections.length) {
      sections.forEach((sec) => {
        const titleEl = sec.querySelector("h2, h3");
        const title = titleEl ? CSR.util.textContentOf(titleEl) : "";
        const clone = CSR.util.cloneWithStyles(sec);
        const cloneTitle = clone.querySelector("h2, h3");
        if (cloneTitle) cloneTitle.remove();
        tagCitations(clone);
        out.push({
          id: sec.id || CSR.util.slugify(title),
          title,
          content: CSR.util.cloneClean(clone, { baseURI: base }),
        });
      });
    } else {
      // Flat fallback: no <section> wrappers found, treat the whole body as one block.
      const clone = CSR.util.cloneWithStyles(body);
      clone.querySelectorAll(NON_CONTENT_SECTION_SELECTOR).forEach((n) => n.remove());
      tagCitations(clone);
      out.push({ id: "body", title: "", content: CSR.util.cloneClean(clone, { baseURI: base }) });
    }
    return out;
  }

  function parse(doc, ctx) {
    doc = doc || document;
    const { url, base } = CSR.util.ctx(doc, ctx);
    const body = CSR.util.genericArticleBody(doc, BODY_SELECTORS);
    if (!body) return null;

    const m = CSR.util.citationMeta(doc);
    const venueParts = [];
    if (m.journal) venueParts.push(m.journal);
    if (m.date) venueParts.push(m.date);
    if (m.doi) venueParts.push("doi:" + m.doi);

    return {
      site: "nature",
      title: m.title || CSR.util.textContentOf(doc.querySelector("h1")) || "Untitled",
      authors: m.authors.length ? m.authors.join(", ") : null,
      venueLine: venueParts.join(" \u00b7 "),
      sourceUrl: url,
      ids: { arxiv: m.arxivId || null, doi: m.doi || null },
      sections: sectionsFrom(doc, body, base),
      bibliography: buildBibliography(doc, base),
    };
  }

  CSR.parsers.push({ id: "nature", detect, parse, sniff });
})();
