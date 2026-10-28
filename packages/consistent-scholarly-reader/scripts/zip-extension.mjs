#!/usr/bin/env node
/**
 * Zip the Chrome extension for distribution.
 * Creates consistent-scholarly-reader.zip in the package root.
 */

import { mkdir, rm } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { createReadStream } from "node:fs";
import archiver from "archiver";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
const OUTPUT = resolve(ROOT, "..", "consistent-scholarly-reader.zip");

async function main() {
  console.log("Building Chrome extension zip...");

  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = createWriteStream(OUTPUT);

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      console.log(`Extension packaged: ${OUTPUT} (${archive.pointer()} bytes)`);
      resolve();
    });
    archive.on("error", reject);
    archive.pipe(output);

    // Files to include in the extension
    const include = [
      "manifest.json",
      "background.js",
      "icons/**",
      "content/**",
      "lib/**",
    ];

    // Add files
    for (const pattern of include) {
      archive.glob(pattern, { cwd: ROOT, ignore: ["**/node_modules/**", "**/.git/**"] });
    }

    archive.finalize();
  });
}

main().catch((e) => {
  console.error("Zip failed:", e);
  process.exit(1);
});