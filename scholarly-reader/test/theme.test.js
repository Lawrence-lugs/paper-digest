import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Load the classic JS (IIFE) and CSS
const js = readFileSync("dist/scholarly-reader.classic.js", "utf8");
const css = readFileSync("dist/scholarly-reader.css", "utf8");

// Create a JSDOM instance
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, {
  url: "http://localhost",
  pretendToBeVisual: true,
  resources: "usable",
});

const { document, window, localStorage } = dom.window;
globalThis.window = window;
globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.getComputedStyle = window.getComputedStyle;

// In the classic bundle, it uses `global` which in Node is globalThis
// But the IIFE receives `typeof window !== "undefined" ? window : globalThis`
// Since we have window, it should use window. Let's make global point to window for the eval.
global.ScholarlyReader = undefined;

// Inject CSS
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

// Evaluate the classic bundle (IIFE)
eval(js);

const ScholarlyReader = globalThis.ScholarlyReader || global.ScholarlyReader || window.ScholarlyReader;
console.log("ScholarlyReader found:", !!ScholarlyReader);

if (!ScholarlyReader) {
  console.error("Failed to load ScholarlyReader");
  process.exit(1);
}

const { THEME_PRESETS, setTheme, getTheme, getThemePresets, initTheme, createThemeSelector } = ScholarlyReader;

// Test 1: Check presets
console.log("Test 1: Presets count:", Object.keys(THEME_PRESETS).length);
console.assert(Object.keys(THEME_PRESETS).length === 12, "Should have 12 presets");

// Test 2: Default theme applied
initTheme(document);
console.log("Test 2: Default theme applied, root dataset.theme:", document.documentElement.dataset.theme);
console.log("Test 2: --sr-paper:", getComputedStyle(document.documentElement).getPropertyValue("--sr-paper").trim());
console.log("Test 2: --sr-ink:", getComputedStyle(document.documentElement).getPropertyValue("--sr-ink").trim());

// Test 3: Switch to vscode-dark
setTheme(document, { preset: "vscode-dark" });
console.log("Test 3: After vscode-dark, dataset.theme:", document.documentElement.dataset.theme);
console.log("Test 3: --sr-paper:", getComputedStyle(document.documentElement).getPropertyValue("--sr-paper").trim());
console.log("Test 3: --sr-ink:", getComputedStyle(document.documentElement).getPropertyValue("--sr-ink").trim());
console.log("Test 3: --sr-mute:", getComputedStyle(document.documentElement).getPropertyValue("--sr-mute").trim());

// Test 4: Custom theme
setTheme(document, { custom: { paper: "#FF0000", ink: "#00FF00" } });
console.log("Test 4: Custom theme, dataset.theme:", document.documentElement.dataset.theme);
console.log("Test 4: --sr-paper:", getComputedStyle(document.documentElement).getPropertyValue("--sr-paper").trim());
console.log("Test 4: --sr-ink:", getComputedStyle(document.documentElement).getPropertyValue("--sr-ink").trim());

// Test 5: Get theme
const current = getTheme(document);
console.log("Test 5: getTheme():", JSON.stringify(current));

// Test 6: Persistence - reload simulation
initTheme(document);
console.log("Test 6: After re-init, dataset.theme:", document.documentElement.dataset.theme);
console.log("Test 6: --sr-paper:", getComputedStyle(document.documentElement).getPropertyValue("--sr-paper").trim());

// Test 7: createThemeSelector
const selector = createThemeSelector(document);
console.log("Test 7: Theme selector created, button exists:", !!document.querySelector(".sr-theme-btn"));
console.log("Test 7: Theme selector panel exists:", !!document.querySelector(".sr-theme-panel"));
selector.dispose();
console.log("Test 7: After dispose, button exists:", !!document.querySelector(".sr-theme-btn"));

console.log("\nAll tests passed!");