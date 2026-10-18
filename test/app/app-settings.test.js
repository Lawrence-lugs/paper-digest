/**
 * Agent C — app shell tests: settings / API key memory-only contract.
 *
 * Runs app.js in jsdom (index.html loaded), so `init()` executes and the
 * Settings DOM is present. `saveSettings`/`loadSettings` are exported from
 * app.js solely to make this contract testable without a browser.
 *
 * Run: node --test test/app/
 */

import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import "./idb-shim.mjs"; // init() -> refreshRecent() -> sessions.list() needs indexedDB
import "./dom-shim.mjs"; // jsdom window/document/localStorage; imports app.js (init runs)
import "../../web/js/app/app.js";
import { loadSettings, saveSettings } from "../../web/js/app/app.js";

const $ = (id) => document.getElementById(id);

const settingsJson = () => JSON.parse(localStorage.getItem("paper-digest-settings") ?? "null");

beforeEach(() => {
  localStorage.clear();
  $("keyInput").value = "";
  $("remember").checked = false;
  $("providerSelect").value = "openrouter";
  $("modelsInput").value = "";
  $("baseUrlInput").value = "";
  $("timeoutInput").value = "";
});

describe("app — settings: key is memory-only unless Remember is checked", () => {
  test("loadSettings does not restore the key when remember=false (memory-only)", () => {
    // Module state is fresh here (settings.apiKey === ""), simulating a page
    // reload: the key must not be restored from localStorage.
    localStorage.setItem(
      "paper-digest-settings",
      JSON.stringify({ provider: "openrouter", models: "m", baseUrl: "", timeoutS: 180, remember: false, apiKey: "sk-in-json" })
    );
    localStorage.setItem("paper-digest-key", "sk-or-ignored");

    loadSettings();
    assert.strictEqual($("keyInput").value, "", "key is not restored; it stays memory-only");
  });

  test("loadSettings restores the key into memory when remember=true", () => {
    localStorage.setItem(
      "paper-digest-settings",
      JSON.stringify({ provider: "openrouter", models: "m", baseUrl: "", timeoutS: 180, remember: true, apiKey: "" })
    );
    localStorage.setItem("paper-digest-key", "sk-or-restored");

    loadSettings();
    assert.strictEqual($("keyInput").value, "••••••••", "restored key is masked in the input");
  });

  test("saveSettings persists settings but not the key when Remember is unchecked", () => {
    $("keyInput").value = "sk-or-test-memory";
    $("remember").checked = false;
    saveSettings();

    assert.strictEqual(localStorage.getItem("paper-digest-key"), null, "key item must not be written");
    assert.ok(settingsJson(), "settings object is persisted");
    assert.strictEqual(settingsJson().apiKey, "sk-or-test-memory");
    assert.strictEqual(settingsJson().remember, false);
  });

  test("saveSettings persists the key only when Remember is checked", () => {
    $("keyInput").value = "sk-or-remember-me";
    $("remember").checked = true;
    saveSettings();

    assert.strictEqual(localStorage.getItem("paper-digest-key"), "sk-or-remember-me");
    assert.strictEqual(settingsJson().remember, true);
  });

  test("saveSettings removes a previously persisted key when Remember is unchecked", () => {
    localStorage.setItem("paper-digest-key", "sk-stale");
    $("keyInput").value = "sk-or-test-memory";
    $("remember").checked = false;
    saveSettings();

    assert.strictEqual(localStorage.getItem("paper-digest-key"), null);
  });

  test("loadSettings restores non-key settings", () => {
    localStorage.setItem(
      "paper-digest-settings",
      JSON.stringify({ provider: "local", models: "custom-model", baseUrl: "http://custom/v1", timeoutS: 90, remember: false, apiKey: "" })
    );
    $("providerSelect").value = "openrouter";
    $("modelsInput").value = "junk";
    $("baseUrlInput").value = "junk";
    $("timeoutInput").value = "1";

    loadSettings();

    assert.strictEqual($("providerSelect").value, "local");
    assert.strictEqual($("modelsInput").value, "custom-model");
    assert.strictEqual($("baseUrlInput").value, "http://custom/v1");
    assert.strictEqual($("timeoutInput").value, "90");
  });

  test("saveSettings persists provider, models, baseUrl, timeout and remember", () => {
    $("providerSelect").value = "openai";
    $("modelsInput").value = "gpt-4o";
    $("baseUrlInput").value = "http://localhost:11434/v1";
    $("timeoutInput").value = "120";
    $("keyInput").value = "sk-fresh";
    $("remember").checked = true;

    saveSettings();

    assert.deepStrictEqual(settingsJson(), {
      provider: "openai",
      models: "gpt-4o",
      baseUrl: "http://localhost:11434/v1",
      timeoutS: 120,
      remember: true,
      apiKey: "sk-fresh",
    });
    assert.strictEqual(localStorage.getItem("paper-digest-key"), "sk-fresh");
  });
});
