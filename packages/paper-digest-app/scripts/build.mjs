#!/usr/bin/env node
/**
 * Build script for paper-digest-app.
 * Copies scholarly-reader dist files to web/assets/scholarly-reader/ for runtime loading.
 * Uses the local monorepo source dist (not node_modules) since we use file: protocol.
 */

import { mkdir, copyFile, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
// Use the monorepo source dist directly (file: protocol copies source, not dist)
const SR_DIST = resolve(ROOT, "..", "scholarly-reader", "dist");
const ASSETS_DIR = resolve(ROOT, "web", "assets", "scholarly-reader");

const FILES = [
  "scholarly-reader.js",
  "scholarly-reader.css",
  "scholarly-reader.classic.js",
];

async function main() {
  console.log("Building paper-digest-app...");
  console.log(`  Source: ${SR_DIST}`);
  console.log(`  Dest:   ${ASSETS_DIR}`);

  await mkdir(ASSETS_DIR, { recursive: true });

  for (const f of FILES) {
    const src = join(SR_DIST, f);
    const dest = join(ASSETS_DIR, f);
    await copyFile(src, dest);
    console.log(`  copied ${f}`);
  }

  console.log("Build complete.");
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});