// Agent D — Reading Mark Functionality Test
//
// This test verifies that the reading mark works correctly in paper-digest generated HTML.
// It checks:
// 1. Reading mark can be toggled with 'R' key
// 2. Reading mark highlights sentences (sr-on class)
// 3. Arrow keys / j,k navigate between units
// 4. Escape deactivates reading mark
// 5. Click on unit activates reading mark at that position
// 6. Hint element appears with correct text

const fs = require("fs");
const { test, expect } = require("playwright/test");

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
This is the second sentence in the first section.

## Motivation (Confidence: 80%)
Local learning addresses the problem of training on-device. The motivation is convincing.
Another sentence here for testing navigation.

## Core idea (Confidence: 80%)
The method works in three steps: collect, adapt, deploy.
Step one is collect. Step two is adapt. Step three is deploy.

## Distinguishing factor (Confidence: 80%)
Compared with prior families, this paper extends rather than replaces them.
This makes it unique in the literature.

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

test.describe("Reading mark functionality in generated HTML", () => {
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

  async function generateAndOpenBlob(page, context) {
    await ingestUrl(page, "/arxiv.html", "arxiv");
    await setKeyAndRunDigest(page);
    const html = await downloadResult(page);

    const blobUrl = await page.evaluate((htmlContent) => {
      const blob = new Blob([htmlContent], { type: "text/html" });
      return URL.createObjectURL(blob);
    }, html);

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

    return { blobPage, blobConsoleErrors, blobPageErrors };
  }

  test("reading mark toggles with R key and highlights units", async ({ page, context }) => {
    const { blobPage, blobConsoleErrors, blobPageErrors } = await generateAndOpenBlob(page, context);

    expect(blobConsoleErrors, "Console errors on load").toEqual([]);
    expect(blobPageErrors, "Page errors on load").toEqual([]);

    // Wait for reading mark to initialize
    await blobPage.waitForTimeout(1000);

    const main = blobPage.locator(".sr-main");
    await expect(main).toBeVisible();

    // Focus main to receive keyboard events
    await main.focus();

    // Initially no reading mark should be active
    let activeUnits = await blobPage.locator(".sr-unit.sr-on").count();
    expect(activeUnits, "No unit should be highlighted initially").toBe(0);

    // Press R to activate reading mark
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(300);

    // Check that reading mark is active (sr-active on container, sr-on on a unit)
    const mainHasActive = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActive, "Container should have sr-active class").toBeTruthy();

    activeUnits = await blobPage.locator(".sr-unit.sr-on").count();
    expect(activeUnits, "Exactly one unit should be highlighted").toBe(1);

    // Check hint element appears
    const hint = blobPage.locator(".sr-hint");
    await expect(hint).toBeVisible();
    const hintText = await hint.textContent();
    expect(hintText).toContain("move");
    expect(hintText).toContain("Esc");

    // Press R again to deactivate
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(200);

    let mainHasActiveAfter = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActiveAfter, "Container should not have sr-active class").toBeFalsy();

    activeUnits = await blobPage.locator(".sr-unit.sr-on").count();
    expect(activeUnits, "No unit should be highlighted after deactivate").toBe(0);

    await blobPage.close();
  });

  test("reading mark navigates with arrow keys and j/k", async ({ page, context }) => {
    const { blobPage, blobConsoleErrors, blobPageErrors } = await generateAndOpenBlob(page, context);

    const main = blobPage.locator(".sr-main");
    await main.focus();

    // Activate reading mark
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(300);

    // Get initial highlighted unit index
    let activeIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(activeIdx).toBeGreaterThanOrEqual(0);

    // Navigate down with ArrowDown
    await blobPage.keyboard.press("ArrowDown");
    await blobPage.waitForTimeout(100);

    let newIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(newIdx).toBe(activeIdx + 1);

    // Navigate up with ArrowUp
    await blobPage.keyboard.press("ArrowUp");
    await blobPage.waitForTimeout(100);

    newIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(newIdx).toBe(activeIdx);

    // Navigate down with j (vim-style)
    await blobPage.keyboard.press("j");
    await blobPage.waitForTimeout(100);

    newIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(newIdx).toBe(activeIdx + 1);

    // Navigate up with k (vim-style)
    await blobPage.keyboard.press("k");
    await blobPage.waitForTimeout(100);

    newIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(newIdx).toBe(activeIdx);

    // Deactivate with Escape
    await blobPage.keyboard.press("Escape");
    await blobPage.waitForTimeout(100);

    const mainHasActive = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActive).toBeFalsy();

    await blobPage.close();
  });

  test("reading mark activates on click", async ({ page, context }) => {
    const { blobPage, blobConsoleErrors, blobPageErrors } = await generateAndOpenBlob(page, context);

    const main = blobPage.locator(".sr-main");
    await main.focus();

    // Get all units
    const unitsCount = await blobPage.locator(".sr-unit").count();
    expect(unitsCount).toBeGreaterThan(2);

    // Click on the third unit
    const thirdUnit = blobPage.locator(".sr-unit").nth(2);
    await thirdUnit.click();
    await blobPage.waitForTimeout(200);

    // Reading mark should be active at clicked position
    const mainHasActive = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActive).toBeTruthy();

    const activeIdx = await blobPage.evaluate(() => {
      const units = document.querySelectorAll(".sr-unit");
      const active = document.querySelector(".sr-unit.sr-on");
      return active ? Array.from(units).indexOf(active) : -1;
    });
    expect(activeIdx).toBe(2);

    await blobPage.close();
  });

  test("reading mark deactivates on Escape", async ({ page, context }) => {
    const { blobPage, blobConsoleErrors, blobPageErrors } = await generateAndOpenBlob(page, context);

    const main = blobPage.locator(".sr-main");
    await main.focus();

    // Activate reading mark
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(300);

    // Verify active
    let mainHasActive = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActive).toBeTruthy();

    // Press Escape
    await blobPage.keyboard.press("Escape");
    await blobPage.waitForTimeout(100);

    // Verify deactivated
    mainHasActive = await main.evaluate(el => el.classList.contains("sr-active"));
    expect(mainHasActive).toBeFalsy();

    const activeUnits = await blobPage.locator(".sr-unit.sr-on").count();
    expect(activeUnits).toBe(0);

    await blobPage.close();
  });

  test("reading mark hint shows correct text for active/inactive states", async ({ page, context }) => {
    const { blobPage, blobConsoleErrors, blobPageErrors } = await generateAndOpenBlob(page, context);

    const main = blobPage.locator(".sr-main");
    await main.focus();

    // Initially hint should say "R: reading marker"
    let hint = blobPage.locator(".sr-hint");
    await expect(hint).toBeVisible();
    let hintText = await hint.textContent();
    expect(hintText).toContain("R: reading marker");

    // Activate
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(200);

    // Hint should now say "↑ ↓ move · Esc exit"
    hintText = await hint.textContent();
    expect(hintText).toContain("move");
    expect(hintText).toContain("Esc");

    // Deactivate
    await blobPage.keyboard.press("r");
    await blobPage.waitForTimeout(200);

    // Hint should be back to "R: reading marker"
    hintText = await hint.textContent();
    expect(hintText).toContain("R: reading marker");

    await blobPage.close();
  });
});