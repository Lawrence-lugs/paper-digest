// Shim a real browser `window` (jsdom) before render.js is imported, so
// createDOMPurify(window) at module load produces a working sanitizer.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
