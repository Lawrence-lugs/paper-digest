/**
 * scripts/sync-csr.mjs
 *
 * Syncs the consistent-scholarly-reader (CSR) parsers the web app reuses into
 * web/vendor/csr/, pinned to a commit recorded in web/vendor/csr/VERSION.
 *
 * Usage:
 *   node scripts/sync-csr.mjs <CSR_REPO_PATH>
 *
 * Copies (read-only in the app; the lead owns the CSR repo):
 *   - content/common.js        -> web/vendor/csr/common.js
 *   - content/parsers/arxiv.js -> web/vendor/csr/parsers/arxiv.js
 *   - content/parsers/nature.js -> web/vendor/csr/parsers/nature.js
 *   - content/parsers/ieee.js  -> web/vendor/csr/parsers/ieee.js
 *   - content/parsers/acm.js   -> web/vendor/csr/parsers/acm.js
 *   - content/parsers/science.js -> web/vendor/csr/parsers/science.js
 *   - content/parsers/index.js -> web/vendor/csr/parsers/index.js
 *
 * It does NOT copy render.js, readingMark.js, citationPeek.js, inject.js or
 * the background script (those belong to the extension, not the digest app).
 *
 * Load order in web/index.html: common.js, then the site parsers (any order),
 * then parsers/index.js (which registers findParsedArticle).
 */

import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const CSR_REPO = resolve(process.argv[2]);
if (!CSR_REPO) {
  console.error("Usage: node scripts/sync-csr.mjs <CSR_REPO_PATH>");
  process.exit(1);
}

const DEST_DIR = resolve(process.cwd(), "web", "vendor", "csr");
const PARSERS_DIR = join(DEST_DIR, "parsers");

const SOURCES = {
  "content/common.js": join(DEST_DIR, "common.js"),
  "content/parsers/arxiv.js": join(PARSERS_DIR, "arxiv.js"),
  "content/parsers/nature.js": join(PARSERS_DIR, "nature.js"),
  "content/parsers/ieee.js": join(PARSERS_DIR, "ieee.js"),
  "content/parsers/acm.js": join(PARSERS_DIR, "acm.js"),
  "content/parsers/science.js": join(PARSERS_DIR, "science.js"),
  "content/parsers/index.js": join(PARSERS_DIR, "index.js"),
};

function gitCommit(repo) {
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    console.error(`Failed to read commit hash from ${repo}: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const commit = gitCommit(CSR_REPO);
  await mkdir(DEST_DIR, { recursive: true });
  await mkdir(PARSERS_DIR, { recursive: true });

  for (const [rel, dest] of Object.entries(SOURCES)) {
    const src = join(CSR_REPO, rel);
    await copyFile(src, dest);
    console.log(`copied ${rel} -> ${dest}`);
  }

  await writeFile(join(DEST_DIR, "VERSION"), commit + "\n");
  console.log(`wrote web/vendor/csr/VERSION = ${commit}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
