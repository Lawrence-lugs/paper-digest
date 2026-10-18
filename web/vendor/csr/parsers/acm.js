// Parser for dl.acm.org (ACM Digital Library) articles.
//
// ⚠️ Best-effort / unverified: ACM's full-text HTML is heavily JS-rendered
// and behind access control, so the selectors below are a best guess based
// on publicly documented ACM DL markup, not a confirmed live DOM dump. If a
// real page doesn't extract cleanly, capture the article body/reference
// list outerHTML from devtools so the selectors can be corrected.
(function () {
  "use strict";
  const CSR = window.CSR;

  function detect(doc, ctx) {
    const { url } = CSR.util.ctx(doc, ctx);
    return url ? /(^|\.)dl\.acm\.org$/.test(new URL(url).hostname) : false;
  }

  // Content-based detection for documents without a URL (paste / upload).
  function sniff(doc) {
    return !!CSR.util.genericArticleBody(doc, BODY_SELECTORS);
  }

  const BODY_SELECTORS = [
    "div.article__body",
    "div.hlFld-Fulltext",
    "div.issue-item__content",
    "section#core-collateral + div",
  ];
  const REF_LIST_SELECTORS = [
    "div.article__references ol",
    "ol.references",
    "div.references",
  ];

  function tagCitations(root) {
    CSR.util.tagCitationRefs(root, 'a[href*="#B"], a[href*="#core-"], a.ref, a[href^="#ref"]', (a) => {
      const href = a.getAttribute("href") || "";
      const i = href.indexOf("#");
      return i >= 0 ? href.slice(i + 1) : null;
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
    const headings = body.querySelectorAll("h2, h3");
    if (!headings.length) {
      const clone = CSR.util.cloneWithStyles(body);
      tagCitations(clone);
      out.push({ id: "body", title: "", content: CSR.util.cloneClean(clone, { baseURI: base }) });
      return out;
    }
    // Split the flat body into (heading, following-siblings-until-next-heading) groups.
    let current = null;
    Array.from(body.children).forEach((node) => {
      if (/^H[23]$/.test(node.tagName)) {
        current = { title: CSR.util.textContentOf(node), id: node.id || CSR.util.slugify(node.textContent), nodes: [] };
        out.push(current);
      } else if (current) {
        current.nodes.push(node);
      }
    });
    return out.map((sec) => {
      const wrapper = doc.createElement("div");
      sec.nodes.forEach((n) => wrapper.appendChild(CSR.util.cloneWithStyles(n)));
      tagCitations(wrapper);
      return { id: sec.id, title: sec.title, content: CSR.util.cloneClean(wrapper, { baseURI: base }) };
    });
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
      site: "acm",
      title: m.title || CSR.util.textContentOf(doc.querySelector("h1")) || "Untitled",
      authors: m.authors.length ? m.authors.join(", ") : null,
      venueLine: venueParts.join(" \u00b7 "),
      sourceUrl: url,
      ids: { arxiv: m.arxivId || null, doi: m.doi || null },
      sections: sectionsFrom(doc, body, base),
      bibliography: buildBibliography(doc, base),
    };
  }

  CSR.parsers.push({ id: "acm", detect, parse, sniff });
})();
