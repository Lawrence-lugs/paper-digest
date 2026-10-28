/**
 * Agent B — output helper tests.
 *
 * - openInTab: about:blank + _blank, opener nulled, URL.createObjectURL(blob)
 *   (NOT the tab/window), tab.location set, returns {blocked, tab, blobUrl}.
 * - downloadHtml: blob URL from the html, <a download>, click, revoke after ~1s.
 * - copyHtml: navigator.clipboard.writeText called with the html.
 * - renderDigest end-to-end: $& in an SVG figure text survives (no $ substitution).
 * - buildPrompt: no figures:/baseUrl: frontmatter keys (Phase 1 carry-over, re-verify).
 *
 * Run: node --test test/pipeline/
 */

import "./shim.mjs"; // real jsdom window/document before pipeline/render are imported
import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildPrompt,
  openInTab,
  downloadHtml,
  copyHtml,
} from "../../web/js/pipeline/pipeline.js";

const source = {
  site: "arxiv",
  ids: { arxiv: "2610.17099", doi: null },
  key: "arxiv:2610.17099",
  title: "Sample Paper",
  authors: ["Jane Doe", "John Smith"],
  venue: "arXiv:2610.17099",
  sourceUrl: "https://arxiv.org/html/2610.17099",
  baseUrl: "https://arxiv.org/html/2610.17099",
  whatRead: "arXiv HTML full text",
  paperText: "# Sample Paper\n\nSome body text.",
  figures: [
    { n: "1", dataA: "S2.F1", caption: "Fig. 1: diagram", url: "https://arxiv.org/html/fig1.png", svg: "" },
    { n: "2", dataA: "S3.F2", caption: "Fig. 2: hardware", url: "", svg: "<svg>...</svg>" },
  ],
  warnings: [],
};

const templatePath = fileURLToPath(new URL("../../web/assets/template.html", import.meta.url));
const template = readFileSync(templatePath, "utf8");

describe("pipeline — openInTab", () => {
  test("opens about:blank/_blank, nulls opener, creates a blob URL from the html (not the tab), navigates", () => {
    const realOpen = window.open;
    const realCreateObjectURL = URL.createObjectURL;
    const realRevokeObjectURL = URL.revokeObjectURL;

    let openedWith = null;
    let capturedTab = null;
    const created = [];
    const revoked = [];

    window.open = (url, target) => {
      openedWith = [url, target];
      capturedTab = { opener: "sentinel", location: "sentinel" };
      return capturedTab;
    };
    URL.createObjectURL = (obj) => {
      created.push(obj);
      return "blob:http://localhost/tab";
    };
    URL.revokeObjectURL = (u) => revoked.push(u);

    try {
      const result = openInTab("<html>body</html>");

      assert.strictEqual(result.blocked, false);
      assert.deepStrictEqual(openedWith, ["about:blank", "_blank"]);
      assert.strictEqual(capturedTab.opener, null, "tab.opener nulled");
      assert.strictEqual(created.length, 1, "URL.createObjectURL called once");
      assert.ok(created[0] instanceof Blob, "createObjectURL received a Blob");
      assert.notStrictEqual(created[0], capturedTab, "createObjectURL received the blob, not the tab/window");
      assert.strictEqual(capturedTab.location, "blob:http://localhost/tab", "tab.location set to blob URL");
      assert.deepStrictEqual(result, {
        blocked: false,
        tab: capturedTab,
        blobUrl: "blob:http://localhost/tab",
      });
      assert.strictEqual(revoked.length, 0, "blob URL not revoked (owned by the tab)");
    } finally {
      window.open = realOpen;
      URL.createObjectURL = realCreateObjectURL;
      URL.revokeObjectURL = realRevokeObjectURL;
    }
  });

  test("returns {blocked: true} when the popup is blocked", () => {
    const realOpen = window.open;
    try {
      window.open = () => null;
      const result = openInTab("<html>body</html>");
      assert.strictEqual(result.blocked, true);
    } finally {
      window.open = realOpen;
    }
  });
});

describe("pipeline — downloadHtml", () => {
  test("creates a blob URL, builds an <a download>, clicks it, and revokes after ~1s", async () => {
    const realCreateObjectURL = URL.createObjectURL;
    const realRevokeObjectURL = URL.revokeObjectURL;
    const realCreateElement = document.createElement.bind(document);

    const created = [];
    const revoked = [];
    let capturedAnchor = null;

    URL.createObjectURL = (obj) => {
      created.push(obj);
      return "blob:http://localhost/download";
    };
    URL.revokeObjectURL = (u) => revoked.push(u);
    document.createElement = (tag) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        let clicked = false;
        const origClick = el.click.bind(el);
        el.click = () => { clicked = true; origClick(); };
        Object.defineProperty(el, "_clicked", { get: () => clicked, configurable: true });
        capturedAnchor = el;
      }
      return el;
    };

    try {
      downloadHtml("<html>body</html>", "digest.html");

      assert.strictEqual(created.length, 1, "one blob URL created");
      assert.ok(created[0] instanceof Blob, "blob URL created from the html");
      assert.ok(capturedAnchor, "an <a> element was created");
      assert.strictEqual(capturedAnchor.download, "digest.html", "download attribute set");
      assert.strictEqual(capturedAnchor.href, "blob:http://localhost/download", "href is the blob URL");
      assert.strictEqual(capturedAnchor._clicked, true, "<a> was clicked");
      assert.strictEqual(revoked.length, 0, "not revoked synchronously");

      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.strictEqual(revoked.length, 1, "blob URL revoked after ~1s");
      assert.strictEqual(revoked[0], "blob:http://localhost/download");
    } finally {
      URL.createObjectURL = realCreateObjectURL;
      URL.revokeObjectURL = realRevokeObjectURL;
      document.createElement = realCreateElement;
    }
  });
});

describe("pipeline — copyHtml", () => {
  test("calls navigator.clipboard.writeText with the html", async () => {
    const realClipboard = navigator.clipboard;
    let written = null;
    navigator.clipboard = {
      writeText: (t) => { written = t; return Promise.resolve(); },
    };

    try {
      await copyHtml("<html>body</html>");
      assert.strictEqual(written, "<html>body</html>");
    } finally {
      navigator.clipboard = realClipboard;
    }
  });
});

describe("pipeline — renderDigest end-to-end", async (t) => {
  const realFetch = globalThis.fetch;

  test("$& and $$ in an SVG figure text survive rendering (no $ substitution)", async () => {
    globalThis.fetch = async () => new Response(template);

    const { renderDigest } = await import("../../web/js/pipeline/render.js");

    const digest = {
      meta: {
        title: "Sample Paper", authors: ["Jane Doe"], venue: "arXiv:2610.17099",
        id: "2610.17099", whatRead: "arXiv HTML", verdict: "A fine paper.", overallConfidence: 80,
      },
      sections: [
        {
          id: "mot", title: "Motivation", confidence: 80,
          content: "see <figure data-n=\"1\"><figcaption>Fig. 1</figcaption></figure>",
        },
      ],
    };

    try {
      const html = await renderDigest(digest, {
        figures: [{
          n: "1", dataA: "S2.F1", caption: "Fig. 1: diagram", url: "",
          svg: '<svg><text x="10" y="10">cost $& and $$ here</text></svg>',
        }],
        baseUrl: null,
      });

      assert.ok(html.includes("$&"), "dollar-ampersand survives in rendered HTML");
      assert.ok(html.includes("$$"), "double dollar survives in rendered HTML");
      assert.ok(!html.includes("{{MAP}}"), "{{MAP}} fully replaced");
      assert.ok(html.includes("const MAP = {};"), "MAP initialized to {} via split/join");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("pipeline — buildPrompt frontmatter keys (Phase 1 carry-over)", () => {
  test("does not inject figures: or baseUrl: as YAML frontmatter keys", () => {
    const p = buildPrompt(source);
    assert.ok(p.includes("BASE URL (the page actually read): https://arxiv.org/html/2610.17099"), "baseUrl present in body");
    assert.ok(!p.includes("figures:"), "no figures: frontmatter key injected");
    assert.ok(!p.includes("baseUrl:"), "no baseUrl: frontmatter key injected");
  });
});
