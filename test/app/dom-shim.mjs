/**
 * Browser-ish globals for tests that import web/js/app/app.js, which runs
 * `init()` at module scope and touches the live DOM (index.html) plus
 * localStorage. render.js (imported via pipeline.js) also reads
 * window.location.href at module load, so this shim must run before app.js
 * is evaluated — hence synchronous (no top-level await).
 *
 * jsdom is a devDependency of the project.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dom = new JSDOM(
  readFileSync(join(process.cwd(), "web", "index.html"), "utf8"),
  { url: "http://localhost/" }
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
