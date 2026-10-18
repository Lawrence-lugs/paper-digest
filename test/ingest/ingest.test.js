/**
 * Agent A — ingest tests.
 *
 * Runs the CSR parsers (synced into consistent-scholarly-reader/) against
 * linkedom/DOMParser documents with an explicit ctx.url, mirroring how the
 * browser feeds parsed (non-live) documents to CSR.
 *
 * Run: node --test test/ingest/
 */

import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseHTML, Node } from "linkedom";
import { runInThisContext } from "node:vm";

import { ingest, FetchBlockedError, inferUrl, articleToSource, genericParse } from "../../web/js/ingest/ingest.js";

const ROOT = process.cwd();
const FIX = join(ROOT, "test", "fixtures");
const CSR = join(ROOT, "consistent-scholarly-reader", "content");

const PARSER_ORDER = [
  "common.js",
  "parsers/arxiv.js",
  "parsers/nature.js",
  "parsers/ieee.js",
  "parsers/acm.js",
  "parsers/science.js",
  "parsers/index.js",
];

async function read(name) {
  return readFile(join(FIX, name), "utf8");
}

/** Run the CSR classic scripts against shimmed browser globals (runInThisContext
 *  so bare `document`/`Node` resolve to the linkedom document we provide). */
async function loadCsr(doc, ctxUrl) {
  globalThis.document = doc;
  globalThis.URL = URL;
  globalThis.Node = Node;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.window = { CSR: {} };
  for (const rel of PARSER_ORDER) {
    const code = await readFile(join(CSR, rel), "utf8");
    runInThisContext(code, { filename: rel });
  }
  return globalThis.window.CSR;
}

function ctx(url) {
  return { url, base: url || "about:blank" };
}

describe("ingest — CSR parsing on detached documents", async (t) => {
  test("CSR loads and exposes findParsedArticle", async () => {
    const { document } = parseHTML("<html><body>x</body></html>");
    const CSR = await loadCsr(document, null);
    assert.strictEqual(typeof CSR.findParsedArticle, "function");
  });

  test("arxiv parser on detached doc with ctx.url", async () => {
    const html = await read("csr/arxiv.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://arxiv.org/html/2610.17099");
    const article = CSR.findParsedArticle(document, ctx("https://arxiv.org/html/2610.17099"));
    assert.ok(article, "arxiv parser returned an article");
    assert.strictEqual(article.site, "arxiv");
    assert.ok(article.sections && article.sections.length > 0, "sections present: " + article.sections.length);
    assert.ok(article.ids && article.ids.arxiv === "2610.17099", "arxiv id present: " + JSON.stringify(article.ids));
    assert.strictEqual(article.sourceUrl, "https://arxiv.org/html/2610.17099");
  });

  test("arxiv sniff works without a URL", async () => {
    const html = await read("arxiv-sample.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, null);
    assert.ok(CSR.parsers.some((p) => p.id === "arxiv" && typeof p.sniff === "function"));
    assert.strictEqual(CSR.parsers.find((p) => p.id === "arxiv").sniff(document), true);
  });

  test("nature parser on detached doc", async () => {
    const html = await read("csr/nature.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://www.nature.com/articles/x");
    const article = CSR.findParsedArticle(document, ctx("https://www.nature.com/articles/x"));
    assert.ok(article, "nature parser returned an article");
    assert.strictEqual(article.site, "nature");
    assert.ok(article.sections.length >= 1, "nature sections present");
    assert.ok(article.ids && article.ids.doi, "nature doi present");
  });

  test("ieee parser on detached doc", async () => {
    const html = await read("csr/ieee.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://ieeexplore.ieee.org/document/12345");
    const article = CSR.findParsedArticle(document, ctx("https://ieeexplore.ieee.org/document/12345"));
    assert.ok(article, "ieee parser returned an article");
    assert.strictEqual(article.site, "ieee");
    assert.ok(article.sections.length >= 1, "ieee sections present");
  });

  test("generic parser for an unsupported site", async () => {
    const html = `<html><body><main><h2>Motivation</h2><p>Some motivation text here about the problem, with enough length to satisfy the generic article body finder's two-hundred-character minimum and let the generic extractor produce a section. This paragraph is intentionally long so the heuristic that requires more than two hundred characters of paragraph text accepts the main element as the body.</p></main></body></html>`;
    const { document } = parseHTML(html);
    // generic (app) parser:
    const gen = genericParse(document, ctx("https://example.com/paper"));
    assert.ok(gen, "generic parser returned an article");
    assert.strictEqual(gen.site, "generic");
    assert.ok(gen.sections.length >= 1);
    assert.ok(gen.title, "generic parser extracted a title");
  });

  test("findParsedArticle tries detect then sniff", async () => {
    const html = await read("csr/nature.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, null);
    // no URL: detect fails for all (hostname-based), sniff finds nature.
    const article = CSR.findParsedArticle(document, ctx(null));
    assert.ok(article, "sniff found nature without a URL");
    assert.strictEqual(article.site, "nature");
  });
});

describe("ingest — articleToSource", async (t) => {
  test("paperText includes title, authors, and ## sections; references excluded", async () => {
    const html = await read("csr/arxiv.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://arxiv.org/html/2610.17099");
    const article = CSR.findParsedArticle(document, ctx("https://arxiv.org/html/2610.17099"));
    const source = articleToSource(article, ctx("https://arxiv.org/html/2610.17099"));
    assert.ok(source.paperText.includes("# Title: Sample Paper on Local Learning"), "title heading present");
    assert.ok(source.paperText.includes("## Motivation"), "section heading present");
    assert.ok(source.paperText.includes("## Core idea"), "second section heading present");
    assert.ok(!source.paperText.includes("Ref one"), "references excluded by default");
  });

  test("figures extracted (SVG serialised, custom property resolved)", async () => {
    const html = await read("csr/arxiv.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://arxiv.org/html/2610.17099");
    const article = CSR.findParsedArticle(document, ctx("https://arxiv.org/html/2610.17099"));
    const source = articleToSource(article, ctx("https://arxiv.org/html/2610.17099"));
    assert.strictEqual(source.figures.length, 1, "figure count: " + JSON.stringify(source.figures));
    assert.strictEqual(source.figures[0].dataA, "S2.F1");
    assert.ok(source.figures[0].svg.includes('<svg'), "SVG serialised");
    assert.ok(source.figures[0].svg.includes('fill="#0E6B73"'), "CSS custom property resolved to literal colour");
    assert.ok(source.figures[0].svg.includes('Fig. 1 diagram'), "svg text retained");
    assert.ok(source.figures.every((f) => !/TABLE/i.test(f.caption)), "no tables");
  });

  test("whatRead describes the parse", async () => {
    const html = await read("csr/arxiv.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://arxiv.org/html/2610.17099");
    const article = CSR.findParsedArticle(document, ctx("https://arxiv.org/html/2610.17099"));
    const source = articleToSource(article, ctx("https://arxiv.org/html/2610.17099"));
    assert.ok(source.whatRead.includes("site=arxiv"), "whatRead: " + source.whatRead);
    assert.ok(source.whatRead.includes("4 sections"), "whatRead section count: " + source.whatRead);
    assert.ok(source.whatRead.includes("1 figure"), "whatRead figure count: " + source.whatRead);
    assert.ok(source.whatRead.includes("references excluded"), "whatRead references excluded: " + source.whatRead);
  });

  test("session key format <site>:<primary id>", async () => {
    const html = await read("csr/arxiv.html");
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, "https://arxiv.org/html/2610.17099v1");
    const article = CSR.findParsedArticle(document, ctx("https://arxiv.org/html/2610.17099v1"));
    const source = articleToSource(article, ctx("https://arxiv.org/html/2610.17099v1"));
    assert.strictEqual(source.key, "arxiv:2610.17099", "version stripped: " + source.key);
  });

  test("relative figure URLs dropped when no URL (about:blank)", async () => {
    const html = `<html><body><article class="ltx_document">
      <section class="ltx_section" id="sec1"><h2 class="ltx_title">S</h2>
      <figure class="ltx_figure" id="S1.F1"><img src="fig1.png"><figcaption>Fig 1.</figcaption></figure>
      </section>
    </article></body></html>`;
    const { document } = parseHTML(html);
    const CSR = await loadCsr(document, null);
    const article = CSR.findParsedArticle(document, ctx(null));
    assert.ok(article, "arxiv sniff found the document");
    const source = articleToSource(article, ctx(null));
    assert.strictEqual(source.baseUrl, null);
    assert.strictEqual(source.figures[0].url, "", "relative url dropped: " + source.figures[0].url);
    assert.ok(!source.figures[0].url.includes("github.io"), "no app-origin mis-resolution");
  });
});

describe("ingest — URL inference", async (t) => {
  test("inferUrl order: baseUrl field, canonical, og:url, citation, saved-from, arxiv id, null", async () => {
    const base = "https://user-supplied/";
    const { document } = parseHTML("<html></html>");
    assert.strictEqual(inferUrl(document, { baseUrl: base }), base);

    const c1 = parseHTML('<html><head><link rel="canonical" href="https://canon.example/"></head></html>').document;
    assert.strictEqual(inferUrl(c1, {}), "https://canon.example/");

    const c2 = parseHTML('<html><head><meta property="og:url" content="https://og.example/"></head></html>').document;
    assert.strictEqual(inferUrl(c2, {}), "https://og.example/");

    const c3 = parseHTML('<html><head><meta name="citation_fulltext_html_url" content="https://citation.example/"></head></html>').document;
    assert.strictEqual(inferUrl(c3, {}), "https://citation.example/");

    const c4 = parseHTML('<html><!-- saved from url=https://saved.example/ --><body></body></html>').document;
    assert.strictEqual(inferUrl(c4, {}), "https://saved.example/");

    const c5 = parseHTML('<html><head><meta name="citation_arxiv_id" content="2405.12345"></head></html>').document;
    assert.strictEqual(inferUrl(c5, {}), "https://arxiv.org/html/2405.12345");

    const c6 = parseHTML("<html><body>no url hints</body></html>").document;
    assert.strictEqual(inferUrl(c6, {}), null);
  });
});

describe("ingest — FetchBlockedError", (t) => {
  test("is a typed error carrying url and reason", () => {
    const e = new FetchBlockedError("https://example.com/x", "network");
    assert.strictEqual(e.name, "FetchBlockedError");
    assert.strictEqual(e.url, "https://example.com/x");
    assert.strictEqual(e.reason, "network");
    assert.ok(/Failed to fetch/.test(e.message));
  });
});

describe("ingest — end-to-end (mocked fetch, CSR parsers loaded)", async (t) => {
  /**
   * Run ingest() against a fixture document with the real CSR parsers loaded
   * into window.CSR (so ingest()'s loadCsr() short-circuits instead of trying
   * to inject <script> tags) and DOMParser stubbed to return the fixture
   * document, keeping the global document the CSR util functions rely on
   * consistent with the document ingest() parses.
   */
  async function ingestFixture(html, input, { fetchBody } = {}) {
    const { document: fixDoc } = parseHTML(html);
    const saved = {
      document: globalThis.document,
      window: globalThis.window,
      DOMParser: globalThis.DOMParser,
      fetch: globalThis.fetch,
    };
    globalThis.document = fixDoc;
    globalThis.URL = URL;
    globalThis.Node = Node;
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
    globalThis.window = { CSR: {} };
    await loadCsr(fixDoc, null);
    globalThis.DOMParser = class {
      parseFromString() {
        return fixDoc;
      }
    };
    if (fetchBody !== undefined) {
      globalThis.fetch = async () => new Response(fetchBody);
    }
    try {
      const source = await ingest(input);
      return { source, doc: fixDoc, CSR: globalThis.window.CSR };
    } finally {
      globalThis.document = saved.document;
      globalThis.window = saved.window;
      globalThis.DOMParser = saved.DOMParser;
      globalThis.fetch = saved.fetch;
    }
  }

  test("ingest() kind:url end-to-end on the arXiv fixture (mocked fetch)", async () => {
    const html = await read("csr/arxiv.html");
    const { source } = await ingestFixture(html, {
      kind: "url",
      value: "https://arxiv.org/abs/2610.17099",
    }, { fetchBody: html });
    assert.strictEqual(source.site, "arxiv", "site: " + source.site);
    assert.strictEqual(source.key, "arxiv:2610.17099", "key: " + source.key);
    assert.ok(
      source.paperText.includes("# Title: Sample Paper on Local Learning"),
      "title in paperText: " + source.paperText,
    );
    assert.strictEqual(source.figures.length, 1, "figure count: " + JSON.stringify(source.figures));
    assert.strictEqual(source.figures[0].dataA, "S2.F1", "dataA: " + JSON.stringify(source.figures[0]));
    assert.strictEqual(source.figures[0].url, "", "inline SVG figure has no image URL");
  });

  test("ingest() kind:html paste with no URL keeps baseUrl null and drops relative figure URLs", async () => {
    // arXiv fixture with the URL hint stripped: a paste supplies no URL at all.
    const html = (await read("csr/arxiv.html")).replace(/<meta name="citation_arxiv_id"[^>]*>\s*/, "");
    const { source } = await ingestFixture(html, { kind: "html", value: html });
    assert.strictEqual(source.baseUrl, null, "baseUrl: " + source.baseUrl);
    assert.strictEqual(source.figures.length, 1, "figure count: " + JSON.stringify(source.figures));
    for (const fig of source.figures) {
      assert.strictEqual(
        fig.url,
        "",
        "relative figure URL dropped: " + fig.url + " (" + fig.dataA + ")",
      );
      assert.ok(
        !fig.url.includes("github.io") && !fig.url.includes("localhost"),
        "no app-origin mis-resolution: " + fig.url,
      );
    }
    assert.strictEqual(source.figures[0].dataA, "S2.F1");
  });

  test("ingest() kind:csr-json converts an Article-shaped object to a Source", async () => {
    const article = {
      site: "arxiv",
      title: "Sample Paper on Local Learning",
      authors: ["Jane Doe", "John Smith"],
      venueLine: "arXiv:2610.17099",
      sourceUrl: "https://arxiv.org/html/2610.17099",
      ids: { arxiv: "2610.17099v1", doi: null },
      sections: [{ id: "s1", title: "Summary", content: { querySelectorAll: () => [] } }],
      bibliography: {},
    };
    const source = await ingest({ kind: "csr-json", value: article });
    assert.strictEqual(source.site, "arxiv", "site: " + source.site);
    assert.strictEqual(source.key, "arxiv:2610.17099", "arXiv version stripped: " + source.key);
    assert.strictEqual(source.title, "Sample Paper on Local Learning");
    assert.ok(source.paperText.includes("# Sample Paper on Local Learning"));
    assert.strictEqual(source.sourceUrl, "https://arxiv.org/html/2610.17099");
  });

  test("ingest() kind:url throws FetchBlockedError when fetch is blocked", async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Failed to fetch: network");
    };
    try {
      let err = null;
      try {
        await ingest({ kind: "url", value: "https://example.com/x" });
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof FetchBlockedError, "expected FetchBlockedError, got: " + err);
      assert.strictEqual(err.url, "https://example.com/x");
      assert.ok(err.reason && typeof err.reason === "string", "reason set: " + err.reason);
      assert.ok(/Failed to fetch/.test(err.message));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test("ingest() kind:html infers https://arxiv.org/html/<id> from citation_arxiv_id meta (no caller URL)", async () => {
    const html = await read("csr/arxiv.html");
    const { source, doc, CSR } = await ingestFixture(html, { kind: "html", value: html });
    assert.strictEqual(
      source.baseUrl,
      "https://arxiv.org/html/2610.17099",
      "synthesized baseUrl: " + source.baseUrl,
    );
    assert.strictEqual(source.sourceUrl, "https://arxiv.org/html/2610.17099");
    assert.strictEqual(source.site, "arxiv", "site: " + source.site);
    assert.strictEqual(source.key, "arxiv:2610.17099", "key: " + source.key);
    const arxivParser = CSR.parsers.find((p) => p.id === "arxiv");
    assert.ok(arxivParser && typeof arxivParser.sniff === "function");
    assert.strictEqual(
      arxivParser.sniff(doc),
      true,
      "arxiv sniff recognizes the document without a URL",
    );
  });
});
