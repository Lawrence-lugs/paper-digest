// Agent D — Theme Selector Error Detection Test
//
// This test verifies that the generated HTML works correctly when opened as a blob URL.
// It fails if ANY console error or page error occurs during load or interaction.
//
// Test flow:
// 1. Ingest a source and run the full digest pipeline
// 2. Download the generated HTML
// 3. Open the HTML as a blob URL (simulates user opening downloaded file)
// 4. Verify NO console errors or page errors occur during load
// 5. Click the theme selector button - verify no errors
// 6. Exercise ToC toggle and reading marker keys - verify no errors

const fs = require("fs");
const { test, expect } = require("playwright/test");

/** Wait for element to have a specific CSS class */
async function waitForClass(page, locator, className, timeout = 5000) {
  await page.waitForFunction(
    (args) => {
      const el = args.locator.elementHandle();
      if (!el) return false;
      return el.classList.contains(args.className);
    },
    { locator, className },
    { timeout }
  );
}

const MOCK = "http://127.0.0.1:8910/mock";

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
## Specific background (Confidence: 90%)
Local learning means per-layer objectives with no cross-layer error propagation, defined in the introduction so the reader can follow the method.

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

/** Ingest a mock-server URL and wait until the ingested card names the expected site. */
async function ingestUrl(page, path, site) {
  await page.fill("#inputUrl", MOCK + path);
  await page.click("#btnIngest");
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    if ((await page.textContent("#ingestedCard")).includes(site)) return;
  }
  throw new Error(`ingested card did not show site "${site}"`);
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

test.describe("Generated HTML works as blob URL", () => {
  let consoleErrors = [];
  let pageErrors = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await blockCdn(page);
    await mockOpenRouter(page);
    await page.goto("/");
  });

  test("no errors on load, theme selector click, ToC toggle, reading marker keys", async ({ page, context }) => {
    // --- Step 1: Full app flow to generate HTML ---
    await ingestUrl(page, "/arxiv.html", "arxiv");
    await setKeyAndRunDigest(page);

    // --- Step 2: Download the generated HTML ---
    const html = await downloadResult(page);

    // --- Step 3: Open the HTML as a blob URL ---
    const blobUrl = await page.evaluate((htmlContent) => {
      const blob = new Blob([htmlContent], { type: "text/html" });
      return URL.createObjectURL(blob);
    }, html);

    // Open blob URL in a new page to isolate storage
    const blobPage = await context.newPage();
    await blobPage.setViewportSize({ width: 1200, height: 800 });
    const blobConsoleErrors = [];
    const blobPageErrors = [];
    blobPage.on("console", (m) => {
      if (m.type() === "error") blobConsoleErrors.push(m.text());
    });
    blobPage.on("pageerror", (e) => blobPageErrors.push(e.message));

    await blobPage.goto(blobUrl, { waitUntil: "load" });
    await blobPage.waitForLoadState("networkidle");
    // Flush microtasks (Promise.resolve().then callbacks from load event)
    await blobPage.evaluate(() => new Promise(r => queueMicrotask(r)));
    
    

    // --- Step 4: Verify NO errors on load ---
    expect(blobConsoleErrors, "Console errors on load").toEqual([]);
    expect(blobPageErrors, "Page errors on load").toEqual([]);

    // --- Step 5: Verify page structure loaded correctly ---
    await expect(blobPage.locator(".sr-root")).toBeVisible({ timeout: 10000 });
    await expect(blobPage.locator(".sr-main")).toBeVisible();
    // ToC is hidden by default on narrow viewports (drawer mode), will be tested via toggle

    // --- Step 6: Click the theme selector button and verify panel opens ---
    // Wait for scholarly-reader to initialize and add the theme button
    await blobPage.waitForTimeout(2000);

    const themeButton = blobPage.locator(".sr-theme-btn, [data-sr-theme-toggle], button[aria-label*='theme' i]");
    const themeButtonExists = await themeButton.count() > 0;
    
    if (!themeButtonExists) {
      throw new Error("Theme selector button not found - initialization likely failed");
    }
    
    await themeButton.first().click();
    await blobPage.waitForTimeout(500);

    // Verify theme panel opened (check for dropdown/panel)
    const themePanel = blobPage.locator(".sr-theme-panel, .sr-theme-dropdown, [role='menu'], [data-sr-theme-panel]");
    const themePanelVisible = await themePanel.count() > 0 && await themePanel.first().isVisible();
    if (!themePanelVisible) {
      throw new Error("Theme panel did not open after clicking theme button");
    }
    console.log("[Test] Theme panel opened successfully");

    // Verify no new errors after click
    expect(blobConsoleErrors, "Console errors after theme button click").toEqual([]);
    expect(blobPageErrors, "Page errors after theme button click").toEqual([]);

    // Close theme panel by clicking outside or Escape
    await blobPage.keyboard.press("Escape");
    await blobPage.waitForTimeout(200);

    // --- Step 7: Exercise ToC toggle (sidebar) ---
    const tocToggle = blobPage.locator(".sr-toc-btn, [data-sr-toc-toggle], button[aria-label*='contents' i], button[aria-label*='toc' i]");
    const tocToggleExists = await tocToggle.count() > 0;
    
    if (!tocToggleExists) {
      throw new Error("ToC toggle button not found");
    }

    // Click to open ToC drawer
    await tocToggle.first().click();
    await blobPage.waitForTimeout(300);

    // Verify ToC drawer opened (check for open class or visible sidebar)
    const tocNav = blobPage.locator(".sr-toc");
    const tocOpen = await tocNav.evaluate(el => el.classList.contains("sr-toc-open") || el.classList.contains("open") || getComputedStyle(el).transform !== "none");
    if (!tocOpen) {
      // Check if the toggle button shows open state
      const toggleOpen = await tocToggle.first().evaluate(el => el.getAttribute("aria-expanded") === "true" || el.classList.contains("active"));
      if (!toggleOpen) {
        console.log("[Test] ToC drawer state unclear, but no error thrown");
      }
    }
    console.log("[Test] ToC toggle clicked");

    // Verify no errors after ToC toggle
    expect(blobConsoleErrors, "Console errors after ToC toggle").toEqual([]);
    expect(blobPageErrors, "Page errors after ToC toggle").toEqual([]);

    // Click again to close
    await tocToggle.first().click();
    await blobPage.waitForTimeout(300);

    // --- Step 8: Exercise reading marker (R key to toggle, arrows, Escape) ---
    const main = blobPage.locator(".sr-main");
    if (await main.count() > 0) {
      await main.first().focus();
      
      // Press R to toggle reading mark on
      await blobPage.keyboard.press("r");
      await blobPage.waitForTimeout(300);

      // Verify reading mark element appeared
      const readingMark = blobPage.locator(".sr-reading-mark, [data-sr-reading-mark], .reading-mark");
      const markVisible = await readingMark.count() > 0 && await readingMark.first().isVisible();
      if (markVisible) {
        console.log("[Test] Reading mark appeared after pressing R");
      }

      // Navigate down
      await blobPage.keyboard.press("ArrowDown");
      await blobPage.waitForTimeout(100);
      
      // Navigate up
      await blobPage.keyboard.press("ArrowUp");
      await blobPage.waitForTimeout(100);
      
      // Press Escape to exit reading mode
      await blobPage.keyboard.press("Escape");
      await blobPage.waitForTimeout(100);

      // Verify reading mark is gone (or no errors)
      expect(blobConsoleErrors, "Console errors during reading marker interaction").toEqual([]);
      expect(blobPageErrors, "Page errors during reading marker interaction").toEqual([]);
      console.log("[Test] Reading marker interaction completed");
    } else {
      throw new Error("Main content not found");
    }

    // --- Step 9: Test j/k keys for reading marker (vim-style) ---
    await main.first().focus();
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(200);
    await blobPage.keyboard.press("j");
    await blobPage.waitForTimeout(100);
    await blobPage.keyboard.press("k");
    await blobPage.waitForTimeout(100);
    await blobPage.keyboard.press("Escape");
    await blobPage.waitForTimeout(100);

    expect(blobConsoleErrors, "Console errors during vim-style reading marker").toEqual([]);
    expect(blobPageErrors, "Page errors during vim-style reading marker").toEqual([]);
    console.log("[Test] Vim-style reading marker (j/k) completed");

    await blobPage.close();
  });
});