/**
 * Agent C — store tests (sessions).
 *
 * IndexedDB round-trip uses an in-memory IndexedDB-like shim (see idb-shim.mjs;
 * Node does not ship IndexedDB, so the store is tested against a mock per the
 * Phase 2 handoff). sessionKey and the pure helpers are tested directly.
 *
 * Run: node --test test/app/
 */

import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import "./idb-shim.mjs"; // installs globalThis.indexedDB shim
import { sessions, sessionKey } from "../../web/js/store/sessions.js";

const now = Date.now();
const baseSession = (overrides = {}) => ({
  site: "arxiv",
  ids: { arxiv: "2610.17099", doi: null },
  key: "arxiv:2610.17099",
  title: "Sample Paper",
  sourceUrl: "https://arxiv.org/html/2610.17099",
  baseUrl: "https://arxiv.org/html/2610.17099",
  figures: [],
  createdAt: now,
  ...overrides,
});

beforeEach(() => {
  globalThis.__idbReset();
});

describe("store — sessions put/get/list round-trip", async (t) => {
  test("put then get returns the stored session", async () => {
    await sessions.put(baseSession({ title: "Stored Session" }));
    const got = await sessions.get("arxiv:2610.17099");
    assert.strictEqual(got?.key, "arxiv:2610.17099");
    assert.strictEqual(got?.title, "Stored Session");
    assert.strictEqual(got?.site, "arxiv");
    assert.deepStrictEqual(got?.ids, { arxiv: "2610.17099", doi: null });
    assert.strictEqual(await sessions.get("arxiv:9999.99999"), null);
  });

  test("list returns sessions newest-first", async () => {
    await sessions.put(baseSession({ key: "arxiv:1111.11111", title: "Old", createdAt: 1 }));
    await sessions.put(baseSession({ key: "arxiv:2222.22222", title: "New", createdAt: 2 }));
    await sessions.put(baseSession({ key: "arxiv:3333.33333", title: "Newest", createdAt: 3 }));
    const items = await sessions.list();
    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0].title, "Newest");
    assert.strictEqual(items[1].title, "New");
    assert.strictEqual(items[2].title, "Old");
  });

  test("put overwrites an existing session (same key)", async () => {
    await sessions.put(baseSession({ title: "First" }));
    await sessions.put(baseSession({ title: "Second" }));
    const items = await sessions.list();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, "Second");
  });
});

describe("store — sessionKey format", () => {
  test("arXiv id is version-stripped: arxiv:2610.17099v3 -> arxiv:2610.17099", () => {
    assert.strictEqual(sessionKey("arxiv", { arxiv: "2610.17099v3" }), "arxiv:2610.17099");
    assert.strictEqual(sessionKey("arxiv", { arxiv: "2610.17099" }), "arxiv:2610.17099");
  });

  test("DOI used as primary id", () => {
    assert.strictEqual(
      sessionKey("acm", { doi: "10.1145/1234567.8901234" }),
      "acm:10.1145/1234567.8901234"
    );
  });

  test("DOI takes precedence over URL hash", () => {
    assert.strictEqual(
      sessionKey("nature", { doi: "10.1038/s41586-026-00001" }, "https://nature.com/x"),
      "nature:10.1038/s41586-026-00001"
    );
  });

  test("URL hash fallback is a stable hex string", () => {
    const url = "https://ieeexplore.ieee.org/document/12345";
    const key = sessionKey("ieee", {}, url);
    assert.strictEqual(key, sessionKey("ieee", {}, url), "hash is stable across calls");
    assert.match(key, /^ieee:[0-9a-f]+$/);
  });

  test("unknown fallback when there are no ids and no URL", () => {
    assert.strictEqual(sessionKey("unknown", {}, undefined), "unknown:unknown");
    assert.strictEqual(sessionKey("unknown", {}, null), "unknown:unknown");
    assert.strictEqual(sessionKey(undefined, {}, ""), "unknown:unknown");
    assert.strictEqual(sessionKey("x", {}), "x:unknown");
  });
});

describe("store — sessions.findByDigest lookup order", async (t) => {
  const seed = async () => {
    await sessions.put(
      baseSession({
        key: "arxiv:2610.17099",
        title: "Alpha Title",
        ids: { arxiv: "2610.17099", doi: null },
        createdAt: 1,
      })
    );
    await sessions.put(
      baseSession({
        key: "acm:10.1145/2222222",
        title: "The Bravo Paper",
        ids: { arxiv: null, doi: "10.1145/2222222" },
        site: "acm",
        createdAt: 2,
      })
    );
    await sessions.put(
      baseSession({
        key: "nature:unknown",
        title: "Charlie",
        ids: { arxiv: null, doi: null },
        site: "nature",
        createdAt: 3,
      })
    );
  };

  test("1. normalized id match (version stripped) wins over title", async () => {
    await seed();
    const found = await sessions.findByDigest({
      meta: { id: "2610.17099v9", title: "The Bravo Paper" },
    });
    assert.strictEqual(found?.key, "arxiv:2610.17099");
    assert.strictEqual(found?.title, "Alpha Title");
  });

  test("1b. DOI id match", async () => {
    await seed();
    const found = await sessions.findByDigest({ meta: { id: "10.1145/2222222" } });
    assert.strictEqual(found?.key, "acm:10.1145/2222222");
  });

  test("2. normalized title fallback when id does not match any key", async () => {
    await seed();
    const found = await sessions.findByDigest({
      meta: { id: "not-an-id", title: "THE   Bravo   Paper" },
    });
    assert.strictEqual(found?.key, "acm:10.1145/2222222");
  });

  test("digest without meta is read from the top level", async () => {
    await seed();
    const found = await sessions.findByDigest({ id: "2610.17099", title: "irrelevant" });
    assert.strictEqual(found?.key, "arxiv:2610.17099");
  });

  test("returns null when nothing matches", async () => {
    await seed();
    assert.strictEqual(
      await sessions.findByDigest({ meta: { id: "9999.99999", title: "Nope" } }),
      null
    );
    assert.strictEqual(await sessions.findByDigest({ meta: {} }), null);
    assert.strictEqual(await sessions.findByDigest({}), null);
  });

  test("empty store returns null", async () => {
    assert.strictEqual(
      await sessions.findByDigest({ meta: { id: "2610.17099" } }),
      null
    );
  });
});
