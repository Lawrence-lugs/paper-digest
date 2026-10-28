#!/usr/bin/env node
/**
 * Copy scholarly-reader dist files to lib/ for Chrome extension manifest.
 * Runs automatically via "prepare" script on npm install.
 * Uses the local monorepo source dist (not node_modules) since we use file: protocol.
 */

import { mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
// Use the monorepo source dist directly (file: protocol copies source, not dist)
const SR_DIST = resolve(ROOT, "..", "scholarly-reader", "dist");
const LIB_DIR = resolve(ROOT, "lib");

const FILES = [
  "scholarly-reader.classic.js",
  "scholarly-reader.css",
];

async function main() {
  console.log("Copying scholarly-reader dist to lib/...");
  console.log(`  Source: ${SR_DIST}`);
  console.log(`  Dest:   ${LIB_DIR}`);

  await mkdir(LIB_DIR, { recursive: true });

  for (const f of FILES) {
    const src = join(SR_DIST, f);
    const dest = join(LIB_DIR, f);
    await copyFile(src, dest);
    console.log(`  copied ${f}`);
  }

  console.log("Copy complete.");
}

main().catch((e) => {
  console.error("Copy failed:", e);
  process.exit(1);
});