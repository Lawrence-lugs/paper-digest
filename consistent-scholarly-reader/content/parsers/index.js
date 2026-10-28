// Picks the first registered parser that both detects the current page and
// successfully produces content (detect() can be true on e.g. an arXiv
// /abs/ page while parse() still returns null because there's no full text).
(function () {
  "use strict";
  const CSR = window.CSR;

  CSR.findParsedArticle = function findParsedArticle(doc, ctx) {
    doc = doc || document;
    for (const parser of CSR.parsers) {
      if (!parser.detect(doc, ctx)) continue;
      const result = parser.parse(doc, ctx);
      if (result) return result;
    }
    // No parser detected the site by URL: try content-based sniffing (for
    // pasted or uploaded documents without a URL). Site parsers opt in with a
    // sniff() method; the app's generic parser is registered last.
    for (const parser of CSR.parsers) {
      if (parser.sniff && parser.sniff(doc)) {
        const result = parser.parse(doc, ctx);
        if (result) return result;
      }
    }
    return null;
  };

  CSR.anyParserDetects = function anyParserDetects(doc) {
    doc = doc || document;
    return CSR.parsers.some((p) => p.detect(doc));
  };
})();
