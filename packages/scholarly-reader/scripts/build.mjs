#!/usr/bin/env node
/**
 * Build script for scholarly-reader.
 * Compiles Tailwind CSS and injects it into the JS bundle.
 * Outputs:
 *   - dist/scholarly-reader.css
 *   - dist/scholarly-reader.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

function run(cmd, args, opts = {}) {
  // On Windows, npx needs .cmd extension
  const isWindows = process.platform === "win32";
  const actualCmd = isWindows && cmd === "npx" ? "npx.cmd" : cmd;
  const result = spawnSync(actualCmd, args, { cwd: ROOT, stdio: "pipe", shell: isWindows, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`${actualCmd} ${args.join(" ")} failed: ${err}`);
  }
  return result.stdout.toString();
}

function main() {
  // Ensure dist exists
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

  // 1. Compile Tailwind CSS from source file
  const cssInputPath = join(ROOT, "tailwind-input.css");

  // Run tailwindcss CLI
  run("npx", ["tailwindcss", "-i", cssInputPath, "-o", join(DIST, "scholarly-reader.css"), "--config", join(ROOT, "tailwind.config.js")]);

  // 2. Read compiled CSS
  const compiledCss = readFileSync(join(DIST, "scholarly-reader.css"), "utf8");

  // 3. Read source JS and replace CSS placeholder
  const sourceJs = readFileSync(join(SRC, "scholarly-reader.js"), "utf8");
  const bundledJs = sourceJs.replace('export const CSS = "";', `export const CSS = ${JSON.stringify(compiledCss)};`);

  // 4. Write bundled JS (ES module for paper-digest)
  writeFileSync(join(DIST, "scholarly-reader.js"), bundledJs);

  // 5. Also produce a classic-script compatible bundle (IIFE) for CSR
  // Strategy: remove `export ` from declarations (making them IIFE-local),
  // then add explicit ScholarlyReader assignments at the end.
  let classicJs = bundledJs
    // Remove `export ` from const/let/var/function declarations
    .replace(/^export (const|let|var|function)\b/gm, '$1')
    // Also handle multi-line export const that were already joined
    .replace(/^export (const|let|var) (\w+)\s*=/gm, '$1 $2 = ');
  // Add explicit exports at the end
  const exportNames = [
    "CSS",
    "DEFAULT_UNIT_SELECTOR",
    "FONT_URL",
    "protectMath",
    "restoreMath",
    "createReadingMark",
    "buildDocument",
    "mountLayout",
    "ensureFonts",
    "removeFonts",
    "THEME_PRESETS",
    "setTheme",
    "getTheme",
    "getThemePresets",
    "initTheme",
    "initThemeForRoot",
    "createThemeSelector",
    "attachThemeSelector",
  ];
  const exportAssignments = exportNames.map((name) => `  ScholarlyReader.${name} = ${name};`).join("\n");
  classicJs = `(function (global) {
  var ScholarlyReader = {};
${classicJs}

${exportAssignments}
  global.ScholarlyReader = ScholarlyReader;
})(typeof window !== "undefined" ? window : globalThis);
`;
  writeFileSync(join(DIST, "scholarly-reader.classic.js"), classicJs);

  console.log("Build complete:");
  console.log(`  ${join(DIST, "scholarly-reader.css")}`);
  console.log(`  ${join(DIST, "scholarly-reader.js")}`);
  console.log(`  ${join(DIST, "scholarly-reader.classic.js")}`);
}

main();
