// Agent D — Phase 2 E2E suite (Playwright).
//
// Runs against a local static server serving web/ (e2e/server.cjs).
// Covers acceptance criteria AC1-AC8 from docs/handoff/D.md.
//
// Notes on environment: Playwright browsers are not downloaded in this
// environment, so system Google Chrome is used via the "chrome" channel.

const fs = require("fs");
const { JSDOM } = require("jsdom");
const { test, expect } = require("playwright/test");

// Base URL of the mock fixture server (e2e/server.cjs serves web/ at root,
// /assets/ and /mock/ too).
const MOCK = "http://127.0.0.1:8910/mock";

// A valid AI digest response: YAML frontmatter + the seven sections, with a
// <figure data-n="1"> that resolves against the ingested source's figures,
// wrapped in a <final> block per the prompt contract.
const DIGEST_MD = `<final>
---
title: Sample Paper on Local Learning
authors: Jane Doe, John Smith
venue: arXiv:2610.17099 (2026)
id: 2610.17099
whatRead: site=arxiv; 4 sections; 1 figure; references excluded
verdict: The paper delivers a local-learning method; evidence supports the core claim where measured, and it is weakest on scaling claims.
overallConfidence: 80
---
## Motivation (Confidence: 80%)
Local learning addresses the problem of training on-device. The motivation is convincing.

## Core idea (Confidence: 80%)
The method works in three steps: collect, adapt, deploy.
<figure data-n="1"><figcaption>Fig. 1: One CNN layer.</figcaption></figure>

## Distinguishing factor (Confidence: 80%)
Compared with prior families, this paper extends rather than replaces them.

## Evaluation and conclusions (Confidence: 80%)
**Accuracy** The paper reports gains on benchmarks. My read: gains are real but narrow.
**Conclusion.** The evidence supports the conclusion for the evaluated scope.

## In case you missed it (Confidence: 80%)
- [pos] The method assumes bounded inputs.

## Cautious judgement (Confidence: 80%)
| Question | Answer | Conf. |
|---|---|---|
| Missing baseline? | none | 0 |
| Custom metric? | none | 0 |
| Echoes earlier work? | some | 0 |
| Reproduced? | no | 0 |

## Sources and limits (Confidence: 80%)
Full text was read; appendix and code were not.
</final>`;

// Digest with XSS payloads in section content (for AC6).
const DIGEST_XSS = DIGEST_MD.replace(
  "Local learning addresses the problem of training on-device. The motivation is convincing.",
  "Local learning addresses the problem of training on-device. <script>alert(1)</script> <span onerror=\"alert(2)\">boom</span> The motivation is convincing."
).replace(
  "The method works in three steps: collect, adapt, deploy.",
  "The method works in three steps: <svg onload=\"alert(3)\"><script>alert(4)</script><foreignObject><div>x</div></foreignObject></svg> collect, adapt, deploy."
);

/** Abort external CDN requests so the suite is hermetic and fast. */
async function blockCdn(page) {
  for (const pat of [
    "**/fonts.googleapis.com/**",
    "**/cdn.tailwindcss.com/**",
    "**/cdn.jsdelivr.net/**",
  ]) {
    await page.route(pat, (route) => route.abort());
  }
}

/** Mock the OpenRouter API to return a valid digest response. */
async function mockOpenRouter(page, content = DIGEST_MD) {
  await page.route("https://openrouter.ai/api/v1/chat/completions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    })
  );
}

/** Poll the ingested card until it names the expected site (ingest is async). */
async function waitForCardSite(page, site) {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    if ((await page.textContent("#ingestedCard")).includes(site)) return;
  }
  throw new Error(`ingested card did not show site "${site}"`);
}

/** Ingest a mock-server URL (absolute, since CSR.util.ctx builds new URL(url)) and wait until the ingested card names the expected site. */
async function ingestUrl(page, path, site) {
  await page.fill("#inputUrl", MOCK + path);
  await page.click("#btnIngest");
  await waitForCardSite(page, site);
}

/** Enter an API key (memory only, "Remember" unchecked) and run the digest. */
async function setKeyAndRunDigest(page) {
  await page.click("#btnSettings");
  await page.fill("#keyInput", "sk-or-e2e-run-key");
  await page.click("#mode-digest");
  await page.click("#btnRun");
  await page.locator("#view-result").waitFor({ state: "visible" });
}

/** Click Download .html and return the rendered HTML document as a string. */
async function downloadResult(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#btnDownload"),
  ]);
  return fs.readFileSync(await download.path(), "utf8");
}

test("AC1 — Pasted arXiv HTML + mocked OpenRouter: every figure shows image or inline SVG", async ({ page }) => {
  const msgs = [];
  page.on("console", (m) => msgs.push(m.text()));
  page.on("pageerror", (e) => msgs.push(e.message));

  await blockCdn(page);
  await mockOpenRouter(page);
  await page.goto("/");

  await ingestUrl(page, "/arxiv.html", "arxiv");
  const card = await page.textContent("#ingestedCard");
  expect(card).toContain("arxiv");
  expect(card).toContain("1 figure detected");
  expect(card).toContain("key: arxiv:2610.17099");

  await setKeyAndRunDigest(page);
  expect(await page.locator("#view-result").isVisible()).toBe(true);
  expect(await page.textContent("#resultMeta")).toContain("1 figure in source");

  // "Open in new tab": openInTab passes the Window (not the Blob) to
  // URL.createObjectURL; standalone probing showed this throws a TypeError
  // (see docs/handoff/e2e.md). Record what this browser actually does.
  let popup;
  try {
    [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 5000 }),
      page.click("#btnOpenTab"),
    ]);
    await popup.waitForLoadState();
  } catch (_) {
    popup = null;
  }
  let popupNote = "no popup";
  if (popup) {
    try {
      popupNote = `url=${popup.url()} body=${JSON.stringify(await popup.textContent("body"))}`;
    } catch (_) {
      popupNote = `url=${popup.url()}`;
    }
  }
  console.log(`AC1 openInTab: ${popupNote}`);

  // The same rendered HTML is verifiable via Download .html.
  const html = await downloadResult(page);
  expect(html).toContain("<svg");
  expect(html).toContain("Fig. 1 diagram");
});

test("AC2 — Prompt flow: copy prompt, paste AI response, figures resolve", async ({ page }) => {
  const msgs = [];
  page.on("console", (m) => msgs.push(m.text()));
  page.on("pageerror", (e) => msgs.push(e.message));

  await blockCdn(page);
  await mockOpenRouter(page);
  await page.goto("/");

  // Ingest a source; its session (with figures) is stored.
  await ingestUrl(page, "/arxiv.html", "arxiv");
  let card = await page.textContent("#ingestedCard");
  expect(card).toContain("arxiv");
  expect(card).toContain("key: arxiv:2610.17099");

  // Copy the master prompt; it references the source's figures by data-n.
  await page.click("#mode-prompt");
  await page.click("#btnCopyPrompt");
  await page.locator("#promptBox").waitFor({ state: "visible" });
  const prompt = await page.textContent("#promptBox");
  expect(prompt).toContain("data-n");
  expect(prompt).toContain("data-a");

  // Paste an AI digest response with <figure data-n="1"> into Template mode;
  // figures resolve from the session store.
  await page.click("#mode-template");
  await page.fill("#inputResponse", DIGEST_MD);
  await page.click("#btnPasteResponse");
  await page.locator("#view-result").waitFor({ state: "visible" });
  const html1 = await downloadResult(page);
  expect(html1).toContain("<svg");
  expect(html1).toContain("Fig. 1 diagram");

  // Reload, open the session from Recent sessions: session found by id.
  await page.reload();
  await blockCdn(page);
  await page.locator("#recentList").waitFor({ state: "visible" });
  expect(await page.textContent("#recentList")).toContain("arxiv:2610.17099");
  await page.locator(".open-recent").first().click();
  await waitForCardSite(page, "key: arxiv:2610.17099");
  card = await page.textContent("#ingestedCard");
  expect(card).toContain("key: arxiv:2610.17099");
  expect(card).toContain("arxiv");

  // Clear IndexedDB, then re-render the same template input against a source
  // without figures: figures fall back to the caption-only state and are
  // never blank (the template's tab script would turn them into "Open Fig. N"
  // links; openInTab itself is broken, see AC1).
  await page.evaluate(() => indexedDB.deleteDatabase("paper-digest"));
  await ingestUrl(page, "/ieee.html", "ieee");
  card = await page.textContent("#ingestedCard");
  expect(card).toContain("ieee");
  expect(card).toContain("0 figures detected");

  await page.click("#mode-template");
  await page.fill("#inputResponse", DIGEST_MD);
  await page.click("#btnPasteResponse");
  await page.locator("#view-result").waitFor({ state: "visible" });
  const html2 = await downloadResult(page);
  const figure = html2.match(/<figure data-n="1">([\s\S]*?)<\/figure>/);
  expect(figure).toBeTruthy();
  expect(figure[1]).toContain("Fig. 1: One CNN layer."); // never blank
  expect(figure[1]).not.toContain("<img"); // no media resolved -> link fallback state
  expect(figure[1]).not.toContain("<svg");

  // The template ships the client script that turns such caption-only
  // figures into "Open Fig. N" links when the page is opened in a tab
  // (openInTab itself is broken, see AC1 / docs/handoff/e2e.md).
  expect(html2).toContain("img.onerror");
  expect(html2).toContain("Open Fig. ");
});

test("AC3 — Mocked fetch failure reveals upload + paste panels with explanation", async ({ page }) => {
  await blockCdn(page);
  await page.route("**/mock/blocked.html", (route) => route.abort());
  await page.goto("/");

  await page.fill("#inputUrl", MOCK + "/blocked.html");
  await page.click("#btnIngest");
  await page.locator("#ingestError").waitFor({ state: "visible" });

  const err = await page.textContent("#ingestError");
  expect(err).toContain("Could not fetch");
  expect(err).toContain("/mock/blocked.html");
  // Plain-language explanation plus the upload/paste alternatives.
  expect(err).toContain("upload or paste it here");
  expect(await page.locator("#inputPaste").isVisible()).toBe(true);
  expect(await page.locator("#fileUpload").isVisible()).toBe(true);
});

test("AC4 — Nature + IEEE fixtures parse; sections + figures in Source", async ({ page }) => {
  await blockCdn(page);
  await page.goto("/");

  await ingestUrl(page, "/nature.html", "nature");
  let card = await page.textContent("#ingestedCard");
  expect(card).toContain("nature");
  expect(card).toMatch(/\d+ sections/); // section count > 0
  expect(card).toMatch(/\d+ figures? detected/);

  await ingestUrl(page, "/ieee.html", "ieee");
  card = await page.textContent("#ingestedCard");
  expect(card).toContain("ieee");
  expect(card).toMatch(/\d+ sections/); // section count > 0
  expect(card).toMatch(/\d+ figures? detected/);

  // Criterion asks for whatRead to contain "abstract only" for IEEE. The
  // current code parses this fixture as two full-text sections (div#article),
  // so "abstract only" is not produced — see docs/handoff/e2e.md.
  expect(card).toContain("abstract only");
});

test("AC5 — Paste with no URL: relative image URLs are not resolved against app origin", async ({ page }) => {
  await blockCdn(page);
  await mockOpenRouter(page);
  await page.goto("/");

  const paste = `<article>
<p>Some introductory text to pass the two-hundred-character body-length heuristic used by the generic article body finder, which requires more than two hundred characters of paragraph text before it will accept a candidate element as the article body.</p>
<figure><img src="fig1.png"><figcaption>Fig 1</figcaption></figure>
</article>`;
  await page.fill("#inputPaste", paste);
  await page.click("#btnIngest");
  await waitForCardSite(page, "1 figure detected");
  const card = await page.textContent("#ingestedCard");
  expect(card).toContain("1 figure detected");
  expect(card).not.toContain("localhost");
  expect(card).not.toContain("127.0.0.1");

  // Render through the full flow: no figure URL may carry the app origin.
  await setKeyAndRunDigest(page);
  const html = await downloadResult(page);
  expect(html).not.toMatch(/localhost|127\.0\.0\.1/);
  // The figure stays caption-only (relative URL dropped); it is never blank.
  expect(html).toContain("Fig. 1");
});

test("AC6 — XSS neutralization: no script, onerror, foreignObject, onload in output", async ({ page }) => {
  await blockCdn(page);
  await mockOpenRouter(page, DIGEST_XSS);
  await page.goto("/");

  await ingestUrl(page, "/arxiv.html", "arxiv");
  await setKeyAndRunDigest(page);

  const html = await downloadResult(page);
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  expect(main).toBeTruthy();
  const body = main[1];
  expect(body).not.toMatch(/<script/i);
  expect(body).not.toMatch(/onerror/i);
  expect(body).not.toMatch(/foreignobject/i);
  expect(body).not.toMatch(/onload/i);
  expect(body).not.toMatch(/alert\(/i);
});

test("AC7 — API key absent from localStorage/sessionStorage unless Remember checked", async ({ page }) => {
  await blockCdn(page);
  await page.goto("/");

  await page.click("#btnSettings");
  await page.fill("#keyInput", "sk-or-ac7-test-key-1234");
  // "Remember" deliberately unchecked: key stays memory-only.
  expect(await page.evaluate(() => localStorage.getItem("paper-digest-key"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("paper-digest-key"))).toBeNull();

  await page.locator("#remember").check();
  expect(await page.evaluate(() => localStorage.getItem("paper-digest-key"))).toBe(
    "sk-or-ac7-test-key-1234"
  );
  expect(await page.evaluate(() => sessionStorage.getItem("paper-digest-key"))).toBeNull();
});

test("AC8 — Figure SVG containing $& survives inlining intact", async ({ page }) => {
  await blockCdn(page);
  await mockOpenRouter(page);
  await page.goto("/");

  await ingestUrl(page, "/dollar.html", "arxiv");
  const card = await page.textContent("#ingestedCard");
  expect(card).toContain("1 figure detected");

  await setKeyAndRunDigest(page);
  const html = await downloadResult(page);
  // The SVG text is escaped as markup ($& -> $&amp;) in the serialized HTML,
  // so check the parsed document's text content.
  const mainText = new JSDOM(html).window.document.querySelector("main").textContent || "";
  expect(mainText).toContain("cost $& and $$");
  expect(mainText).toContain("$&");
  expect(mainText).toContain("$$");
});
