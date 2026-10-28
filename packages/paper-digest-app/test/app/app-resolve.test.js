/**
 * Agent C — app shell tests: resolveSourceFromDigest logic.
 *
 * resolveSourceFromDigest returns currentSource if set, else falls back to
 * sessions.findByDigest (normalized id first, then normalized title), else
 * null. The store is backed by an in-memory IndexedDB-like shim; jsdom
 * provides the DOM app.js needs at import time (init() runs at module scope).
 *
 * Run: node --test test/app/
 */

import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import "./idb-shim.mjs";
import { sessions } from "../../web/js/store/sessions.js";
import "./dom-shim.mjs"; // jsdom window/document; imports app.js (init runs)
import "../../web/js/app/app.js";
import { resolveSourceFromDigest, refreshRecent } from "../../web/js/app/app.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

const session = (overrides) => ({
  site: "arxiv",
  ids: { arxiv: "2610.17099", doi: null },
  key: "arxiv:2610.17099",
  title: "Sample Paper",
  sourceUrl: "https://arxiv.org/html/2610.17099",
  baseUrl: "https://arxiv.org/html/2610.17099",
  figures: [],
  warnings: [],
  createdAt: 1,
  ...overrides,
});

beforeEach(() => {
  globalThis.__idbReset();
});

describe("app — resolveSourceFromDigest", async (t) => {
  test("returns null when nothing matches and there is no current source", async () => {
    assert.strictEqual(await resolveSourceFromDigest({ meta: { id: "9999.99999", title: "Nope" } }), null);
    assert.strictEqual(await resolveSourceFromDigest({}), null);
  });

  test("falls back to sessions.findByDigest by normalized id (arXiv, version stripped)", async () => {
    await sessions.put(
      session({
        key: "arxiv:2610.17099",
        title: "Alpha",
        ids: { arxiv: "2610.17099", doi: null },
        figures: [{ n: "1", dataA: "S2.F1", caption: "Fig 1", url: "https://arxiv.org/html/f1.svg", svg: "<svg/>" }],
        baseUrl: "https://arxiv.org/html/2610.17099",
      })
    );

    const found = await resolveSourceFromDigest({ meta: { id: "2610.17099v2", title: "anything" } });
    assert.strictEqual(found?.key, "arxiv:2610.17099");
    assert.strictEqual(found?.title, "Alpha");
    assert.strictEqual(found?.site, "arxiv");
    assert.strictEqual(found?.baseUrl, "https://arxiv.org/html/2610.17099");
    assert.strictEqual(found?.figures.length, 1);
    assert.strictEqual(found?.sourceUrl, "https://arxiv.org/html/2610.17099");
  });

  test("falls back to sessions.findByDigest by normalized title when id matches nothing", async () => {
    await sessions.put(
      session({ key: "acm:10.1145/2222222", title: "The Bravo Paper", ids: { arxiv: null, doi: "10.1145/2222222" }, site: "acm" })
    );

    const found = await resolveSourceFromDigest({ meta: { id: "garbage", title: "the  bravo paper" } });
    assert.strictEqual(found?.key, "acm:10.1145/2222222");
    assert.strictEqual(found?.title, "The Bravo Paper");
    assert.strictEqual(found?.site, "acm");
  });

  test("normalized id lookup takes precedence over title lookup", async () => {
    await sessions.put(session({ key: "arxiv:2610.17099", title: "Alpha", ids: { arxiv: "2610.17099" }, createdAt: 1 }));
    await sessions.put(session({ key: "acm:10.1145/2222222", title: "The Bravo Paper", ids: { arxiv: null, doi: "10.1145/2222222" }, site: "acm", createdAt: 2 }));

    const found = await resolveSourceFromDigest({ meta: { id: "2610.17099", title: "the bravo paper" } });
    assert.strictEqual(found?.key, "arxiv:2610.17099", "id match wins over title match");
  });

  test("currentSource wins over the store lookup", async () => {
    await sessions.put(session({ key: "arxiv:2610.17099", title: "Alpha", ids: { arxiv: "2610.17099" }, createdAt: 1 }));
    await sessions.put(session({ key: "acm:10.1145/2222222", title: "The Bravo Paper", ids: { arxiv: null, doi: "10.1145/2222222" }, site: "acm", createdAt: 2 }));

    // init() already rendered the recent list; refresh to include seeded sessions.
    await refreshRecent();
    const openA = document.querySelector(".open-recent[data-key='arxiv:2610.17099']");
    assert.ok(openA, "recent list rendered an Open button for the seeded session");
    openA.click();
    await flush(); // let the async open handler set currentSource

    // digest.id would match the ACM session in the store, but currentSource is set.
    const found = await resolveSourceFromDigest({ meta: { id: "10.1145/2222222", title: "irrelevant" } });
    assert.strictEqual(found?.key, "arxiv:2610.17099", "currentSource takes precedence over findByDigest");
    assert.strictEqual(found?.title, "Alpha");
    assert.strictEqual(found?.site, "arxiv");
  });
});
