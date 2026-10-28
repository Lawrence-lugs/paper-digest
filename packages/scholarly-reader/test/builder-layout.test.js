/**
 * Unit tests for builder, layout, math protection, and fonts.
 * Run with: node --test test/builder-layout.test.js
 */

import { JSDOM } from "jsdom";
import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";
import {
  protectMath,
  restoreMath,
  buildDocument,
  mountLayout,
  ensureFonts,
  removeFonts,
} from "../src/scholarly-reader.js";

function createDOM(html = "<!doctype html><html><body></body></html>") {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
  return dom.window;
}

function createDocument() {
  const window = createDOM();
  return window.document;
}

describe("protectMath / restoreMath", () => {
  test("protects $$...$$ display math", () => {
    const source = "Text $$E=mc^2$$ more text";
    const { text, blocks } = protectMath(source);
    assert.ok(text.includes("\x00MATH0\x00"));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0], "\\[E=mc^2\\]");
  });

  test("protects \\(...\\) inline math", () => {
    const source = "Text \\(x+y\\) more text";
    const { text, blocks } = protectMath(source);
    assert.ok(text.includes("\x00MATH0\x00"));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0], "\\(x+y\\)");
  });

  test("protects mixed math", () => {
    const source = "$$display$$ and \\(inline\\)";
    const { text, blocks } = protectMath(source);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0], "\\[display\\]");
    assert.equal(blocks[1], "\\(inline\\)");
  });

  test("lone $ is not treated as math", () => {
    const source = "Price is $100 and $200";
    const { text, blocks } = protectMath(source);
    assert.equal(text, source);
    assert.equal(blocks.length, 0);
  });

  test("restoreMath round trip produces escaped HTML", () => {
    const source = "Text $$E=mc^2$$ and \\(x+y\\)";
    const { text, blocks } = protectMath(source);
    const html = "<p>" + text + "</p>";
    const restored = restoreMath(html, blocks);
    assert.ok(restored.includes("\\[E=mc^2\\]"));
    assert.ok(restored.includes("\\(x+y\\)"));
    assert.ok(!restored.includes("\x00MATH"));
  });

  test("restoreMath escapes HTML special chars", () => {
    const source = "$a < b && c > d$";
    const { text, blocks } = protectMath(source);
    const html = "<p>" + text + "</p>";
    const restored = restoreMath(html, blocks);
    // Output has HTML entities: < > &
    assert.ok(restored.includes("a < b && c > d"));
    // Don't check for raw chars since entities contain them as substrings
  });

  test("handles null/undefined source", () => {
    const { text, blocks } = protectMath(null);
    assert.equal(text, "");
    assert.equal(blocks.length, 0);

    const { text: t2, blocks: b2 } = protectMath(undefined);
    assert.equal(t2, "");
    assert.equal(b2.length, 0);
  });
});

describe("buildDocument - block types", () => {
  let document, ctx;

  beforeEach(() => {
    document = createDocument();
    ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => html,
    };
  });

  test("markdown block", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{ type: "markdown", text: "Hello world" }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    const p = main.querySelector("p");
    assert.ok(p);
    assert.ok(p.textContent.includes("Hello world"));
  });

  test("items block", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{
          type: "items",
          items: [
            { text: "Item 1" },
            { markdown: "**Item 2**" },
            { text: "Item 3", badge: { tone: "pos", label: "good" } }
          ]
        }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    const items = main.querySelectorAll(".sr-item");
    assert.equal(items.length, 3);
    assert.ok(items[0].textContent.includes("Item 1"));
    assert.ok(items[1].textContent.includes("Item 2"));
    assert.ok(items[2].querySelector(".sr-badge.sr-tone-pos"));
  });

  test("table block", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{
          type: "table",
          head: ["Col 1", "Col 2"],
          rows: [
            ["A1", "B1"],
            ["A2", { markdown: "**B2**" }],
            [{ badge: { tone: "neg", label: "bad" } }, "B3"]
          ]
        }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    const table = main.querySelector("table");
    assert.ok(table);
    const headers = table.querySelectorAll("th");
    assert.equal(headers.length, 2);
    const rows = table.querySelectorAll("tbody tr");
    assert.equal(rows.length, 3);
    assert.ok(rows[1].querySelector("td:nth-child(2)").textContent.includes("B2"));
    assert.ok(rows[2].querySelector("td:first-child .sr-badge.sr-tone-neg"));
  });

  test("html block", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{
          type: "html",
          html: "<div class='custom'>Raw HTML</div>"
        }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    const div = main.querySelector(".custom");
    assert.ok(div);
    assert.equal(div.textContent, "Raw HTML");
  });

  test("figure block resolves against figures list", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{ type: "figure", n: "1" }]
      }],
      figures: [{ n: "1", caption: "Fig 1", url: "http://example.com/fig1.png" }]
    };
    const { main } = buildDocument(model, ctx);
    const fig = main.querySelector("figure.sr-figure");
    assert.ok(fig);
    assert.equal(fig.getAttribute("data-n"), "1");
    const img = fig.querySelector("img");
    assert.ok(img);
    assert.equal(img.getAttribute("src"), "http://example.com/fig1.png");
  });

  test("figure block with SVG", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{ type: "figure", n: "2" }]
      }],
      figures: [{ n: "2", caption: "Fig 2", svg: "<svg>test</svg>" }]
    };
    const { main } = buildDocument(model, ctx);
    const fig = main.querySelector("figure.sr-figure");
    const svg = fig.querySelector("svg");
    assert.ok(svg);
  });

  test("figure block with dataA", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{ type: "figure", n: "3" }]
      }],
      figures: [{ n: "3", dataA: "S1.F1", caption: "Fig 3" }]
    };
    const { main } = buildDocument(model, ctx);
    const fig = main.querySelector("figure.sr-figure");
    assert.equal(fig.getAttribute("data-a"), "S1.F1");
  });

  test("nodes block passes node identity through", () => {
    const liveNode = document.createElement("div");
    liveNode.textContent = "Live node";
    const model = {
      sections: [{
        title: "Test",
        blocks: [{ type: "nodes", nodes: [liveNode] }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    assert.ok(main.contains(liveNode));
    assert.strictEqual(main.querySelector("div"), liveNode);
  });

  test("badge tones map to expected classes", () => {
    const model = {
      sections: [{
        title: "Test",
        blocks: [{
          type: "items",
          items: [
            { text: "pos", badge: { tone: "pos" } },
            { text: "neg", badge: { tone: "neg" } },
            { text: "neu", badge: { tone: "neu" } },
            { text: "accent", badge: { tone: "accent" } },
            { text: "invalid", badge: { tone: "invalid" } },
          ]
        }]
      }]
    };
    const { main } = buildDocument(model, ctx);
    const badges = main.querySelectorAll(".sr-badge");
    assert.equal(badges.length, 5);
    assert.ok(badges[0].classList.contains("sr-tone-pos"));
    assert.ok(badges[1].classList.contains("sr-tone-neg"));
    assert.ok(badges[2].classList.contains("sr-tone-neu"));
    assert.ok(badges[3].classList.contains("sr-tone-accent"));
    assert.ok(badges[4].classList.contains("sr-tone-neu"));
  });

  test("header with kicker, kickerHref, authors, verdict", () => {
    const model = {
      header: {
        kicker: "Preprint",
        kickerHref: "https://example.com",
        title: "Paper Title",
        authors: "Author One, Author Two",
        verdict: { text: "Great paper", badge: { tone: "pos", label: "accept" } }
      },
      sections: []
    };
    const { main } = buildDocument(model, ctx);
    const header = main.querySelector(".sr-header");
    assert.ok(header);
    assert.ok(header.querySelector(".sr-kicker-link"));
    assert.equal(header.querySelector(".sr-title").textContent, "Paper Title");
    assert.equal(header.querySelector(".sr-authors").textContent, "Author One, Author Two");
    const verdict = header.querySelector(".sr-verdict");
    assert.ok(verdict);
    assert.ok(verdict.textContent.includes("Great paper"));
    assert.ok(verdict.querySelector(".sr-badge.sr-tone-pos"));
  });

  test("section with id and badge", () => {
    const model = {
      sections: [{
        id: "sec1",
        title: "Section 1",
        badge: { tone: "accent", label: "new" },
        blocks: []
      }]
    };
    const { main } = buildDocument(model, ctx);
    const h2 = main.querySelector("h2.sr-h2");
    assert.ok(h2);
    assert.equal(h2.id, "sec1");
    assert.ok(h2.querySelector(".sr-badge.sr-tone-accent"));
  });

  test("end-to-end with every block type", () => {
    const model = {
      header: { title: "Full Test", authors: "Me" },
      sections: [
        {
          id: "s1",
          title: "Section 1",
          blocks: [
            { type: "markdown", text: "Markdown content" },
            { type: "items", items: [{ text: "Item" }] },
            { type: "table", head: ["H"], rows: [["C"]] },
            { type: "html", html: "<span>HTML</span>" },
            { type: "figure", n: "1" },
            { type: "nodes", nodes: [document.createTextNode("Text node")] }
          ]
        },
        {
          id: "s2",
          title: "Section 2",
          blocks: [{ type: "markdown", text: "Another section" }]
        }
      ],
      figures: [{ n: "1", caption: "Fig", url: "x.png" }]
    };
    const { root, main, toc } = buildDocument(model, ctx);
    assert.ok(root.classList.contains("sr-root"));
    assert.ok(main.querySelector(".sr-header"));
    assert.ok(main.querySelector("h2.sr-h2#s1"));
    assert.ok(main.querySelector("h2.sr-h2#s2"));
    assert.ok(main.querySelector(".sr-item"));
    assert.ok(main.querySelector(".sr-table-wrap"));
    assert.ok(main.querySelector(".custom") || main.querySelector("span"));
    assert.ok(main.querySelector(".sr-figure"));
    assert.ok(toc);
    assert.ok(toc.classList.contains("sr-toc"));
    assert.ok(root.querySelector(".sr-toc"));
  });
});

describe("buildDocument - sanitizer and markdown", () => {
  let document;

  beforeEach(() => {
    document = createDocument();
  });

  test("sanitizer called for markdown blocks", () => {
    let sanitizeCalled = false;
    const ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => { sanitizeCalled = true; return html; }
    };
    const model = { sections: [{ title: "T", blocks: [{ type: "markdown", text: "x" }] }] };
    buildDocument(model, ctx);
    assert.ok(sanitizeCalled);
  });

  test("sanitizer called for html blocks", () => {
    let sanitizeCalled = false;
    const ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => { sanitizeCalled = true; return html; }
    };
    const model = { sections: [{ title: "T", blocks: [{ type: "html", html: "<div>x</div>" }] }] };
    buildDocument(model, ctx);
    assert.ok(sanitizeCalled);
  });

  test("throws when markdown block but no markdown function", () => {
    const ctx = { document, sanitize: (h) => h };
    const model = { sections: [{ title: "T", blocks: [{ type: "markdown", text: "x" }] }] };
    assert.throws(() => buildDocument(model, ctx), /opts\.markdown is required/);
  });

  test("throws when html block but no sanitize function", () => {
    const ctx = { document, markdown: (s) => s };
    const model = { sections: [{ title: "T", blocks: [{ type: "html", html: "x" }] }] };
    assert.throws(() => buildDocument(model, ctx), /opts\.sanitize is required/);
  });

  test("throws when markdown block but no sanitize function", () => {
    const ctx = { document, markdown: (s) => s };
    const model = { sections: [{ title: "T", blocks: [{ type: "markdown", text: "x" }] }] };
    assert.throws(() => buildDocument(model, ctx), /opts\.sanitize is required/);
  });
});

describe("buildDocument - ToC", () => {
  let document, ctx;

  beforeEach(() => {
    document = createDocument();
    ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => html,
    };
  });

  test("ToC created when 2+ headings", () => {
    const model = {
      sections: [
        { title: "Section 1", blocks: [] },
        { title: "Section 2", blocks: [] }
      ]
    };
    const { toc } = buildDocument(model, ctx);
    assert.ok(toc);
    assert.ok(toc.classList.contains("sr-toc"));
    const links = toc.querySelectorAll(".sr-toc-link");
    assert.equal(links.length, 2);
  });

  test("ToC not created when < 2 headings", () => {
    const model = {
      sections: [{ title: "Only Section", blocks: [] }]
    };
    const { toc } = buildDocument(model, ctx);
    assert.equal(toc, null);
  });

  test("ToC includes h3 as sub-items", () => {
    const model = {
      sections: [
        { title: "Section 1", blocks: [{ type: "html", html: "<h3>Subsection</h3>" }] },
        { title: "Section 2", blocks: [] }
      ]
    };
    const { toc, main } = buildDocument(model, ctx);
    const h3 = main.querySelector("h3");
    assert.ok(h3.id);
    const links = toc.querySelectorAll(".sr-toc-link");
    assert.equal(links.length, 3);
    assert.ok(Array.from(links).some(l => l.classList.contains("sr-toc-sub")));
  });

  test("heading without id gets auto-generated id", () => {
    const model = {
      sections: [
        { title: "Section 1", blocks: [] },
        { title: "Section 2", blocks: [] }
      ]
    };
    const { main } = buildDocument(model, ctx);
    const h2s = main.querySelectorAll("h2.sr-h2");
    assert.ok(h2s[0].id.startsWith("sr-h-"));
    assert.ok(h2s[1].id.startsWith("sr-h-"));
  });
});

describe("mountLayout - basic", () => {
  let window, document, root;

  beforeEach(() => {
    window = createDOM(`
      <!doctype html>
      <html>
      <body>
        <div id="root"></div>
      </body>
      </html>
    `);
    document = window.document;
  });

  function setupLayout(sections = 3) {
    const model = {
      sections: Array.from({ length: sections }, (_, i) => ({
        title: `Section ${i + 1}`,
        blocks: [{ type: "markdown", text: "Content ".repeat(20) }]
      }))
    };
    const ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => html,
    };
    const { root: r } = buildDocument(model, ctx);
    root = r;
    document.body.appendChild(root);
    return mountLayout(root, { window, scroller: window });
  }

  test("mountLayout returns dispose function", () => {
    const layout = setupLayout();
    assert.equal(typeof layout.dispose, "function");
    layout.dispose();
  });

  test("dispose cleans up listeners", () => {
    const layout = setupLayout();
    layout.dispose();
    layout.dispose();
  });
});

describe("mountLayout - margin check (wide ToC)", () => {
  let window, document, root;

  beforeEach(() => {
    window = createDOM(`
      <!doctype html>
      <html>
      <body style="font-size: 16px;">
        <div id="root"></div>
      </body>
      </html>
    `);
    document = window.document;
  });

  function setupRoot() {
    const model = { sections: [{ title: "S1", blocks: [] }, { title: "S2", blocks: [] }] };
    const ctx = {
      document,
      markdown: (src) => `<p>${src}</p>`,
      sanitize: (html) => html,
    };
    const { root: r } = buildDocument(model, ctx);
    root = r;
    document.body.appendChild(root);
  }

  test("adds sr-toc-wide when margin >= 16.5rem", () => {
    setupRoot();
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (el) => {
      if (el === document.documentElement) {
        return { fontSize: "16px" };
      }
      return originalGetComputedStyle(el);
    };
    const page = root.querySelector(".sr-page");
    page.getBoundingClientRect = () => ({ left: 300 });
    const layout = mountLayout(root, { window });
    assert.ok(root.classList.contains("sr-toc-wide"));
    layout.dispose();
  });

  test("removes sr-toc-wide when margin < 16.5rem", () => {
    setupRoot();
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (el) => {
      if (el === document.documentElement) return { fontSize: "16px" };
      return originalGetComputedStyle(el);
    };
    const page = root.querySelector(".sr-page");
    page.getBoundingClientRect = () => ({ left: 200 });
    const layout = mountLayout(root, { window });
    assert.ok(!root.classList.contains("sr-toc-wide"));
    layout.dispose();
  });
});

describe("ensureFonts / removeFonts", () => {
  let window, document;

  beforeEach(() => {
    window = createDOM();
    document = window.document;
  });

  test("ensureFonts adds font link and preconnect", () => {
    ensureFonts(document);
    const link = document.getElementById("sr-fonts");
    const preconnect = document.getElementById("sr-fonts-preconnect");
    assert.ok(link);
    assert.equal(link.rel, "stylesheet");
    assert.ok(link.href.includes("fonts.googleapis.com"));
    assert.ok(preconnect);
    assert.equal(preconnect.rel, "preconnect");
  });

  test("ensureFonts is idempotent", () => {
    ensureFonts(document);
    ensureFonts(document);
    const links = document.querySelectorAll("#sr-fonts");
    assert.equal(links.length, 1);
  });

  test("removeFonts removes both elements", () => {
    ensureFonts(document);
    removeFonts(document);
    assert.equal(document.getElementById("sr-fonts"), null);
    assert.equal(document.getElementById("sr-fonts-preconnect"), null);
  });

  test("removeFonts is idempotent", () => {
    removeFonts(document);
    removeFonts(document);
  });
});