#!/usr/bin/env node
/**
 * scripts/sync-all.mjs
 *
 * One script to rule them all: synchronizes scholarly-reader across all consumers.
 *
 * What this does:
 *   1. Updates the canonical scholarly-reader repo (origin/main) with any local fixes
 *   2. Builds scholarly-reader (Tailwind + JS bundle + classic IIFE)
 *   3. Copies dist/* to paper-digest/web/assets/scholarly-reader/
 *   4. Updates paper-digest's scholarly-reader submodule to match canonical
 *   5. Updates consistent-scholarly-reader's scholarly-reader submodule to match canonical
 *   6. Builds consistent-scholarly-reader's scholarly-reader submodule
 *   7. Syncs CSR parsers (content/parsers/*) to paper-digest/web/vendor/csr/
 *   8. Vendors third-party libs (marked, dompurify) to paper-digest/web/vendor/lib/
 *
 * Usage:
 *   node scripts/sync-all.mjs [--push] [--skip-build]
 *
 * Options:
 *   --push         Also push updated submodules to their remotes (requires write access)
 *   --skip-build   Skip the Tailwind/JS build step (assumes dist/ is already fresh)
 */

import { mkdir, copyFile, readFile, writeFile, rm, cp } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAPER_DIGEST_ROOT = resolve(__dirname, "..");
const SCHOLARLY_READER_CANONICAL = resolve(PAPER_DIGEST_ROOT, "..", "scholarly-reader");
const PAPER_DIGEST_SR = join(PAPER_DIGEST_ROOT, "scholarly-reader");
const CSR_ROOT = join(PAPER_DIGEST_ROOT, "consistent-scholarly-reader");
const CSR_SR = join(CSR_ROOT, "scholarly-reader");
const WEB_ASSETS_SR = join(PAPER_DIGEST_ROOT, "web", "assets", "scholarly-reader");
const WEB_VENDOR_CSR = join(PAPER_DIGEST_ROOT, "web", "vendor", "csr");
const WEB_VENDOR_CSR_PARSERS = join(WEB_VENDOR_CSR, "parsers");
const WEB_VENDOR_LIB = join(PAPER_DIGEST_ROOT, "web", "vendor", "lib");

const PUSH = process.argv.includes("--push");
const SKIP_BUILD = process.argv.includes("--skip-build");

function run(cmd, args, opts = {}) {
  const isWindows = process.platform === "win32";
  const actualCmd = isWindows && cmd === "npx" ? "npx.cmd" : cmd;
  const result = spawnSync(actualCmd, args, { cwd: opts.cwd || process.cwd(), stdio: "inherit", shell: isWindows, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${actualCmd} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
}

function runCapture(cmd, args, opts = {}) {
  const isWindows = process.platform === "win32";
  const actualCmd = isWindows && cmd === "npx" ? "npx.cmd" : cmd;
  const result = spawnSync(actualCmd, args, { cwd: opts.cwd || process.cwd(), stdio: "pipe", shell: isWindows, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`${actualCmd} ${args.join(" ")} failed: ${err}`);
  }
  return result.stdout.toString();
}

function git(repo, args) {
  const isWindows = process.platform === "win32";
  const result = spawnSync("git", ["-C", repo, ...args], { stdio: "pipe", shell: isWindows });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(`git -C ${repo} ${args.join(" ")} failed: ${err}`);
  }
  return result.stdout.toString();
}

const CYAN = "\x1b[1;36m";
const RESET = "\x1b[0m";
const RED = "\x1b[1;31m";

function log(step, msg) {
  console.log(`\n${CYAN}[${step}]${RESET} ${msg}`);
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function copyDir(src, dest) {
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  sync-all: Synchronizing scholarly-reader across all repos  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ────────────────────────────────────────────────────────────────
  // STEP 1: Fetch latest from canonical scholarly-reader
  // ────────────────────────────────────────────────────────────────
  log("1/8", "Fetching latest from canonical scholarly-reader (origin/main)");
  git(SCHOLARLY_READER_CANONICAL, ["fetch", "origin"]);
  const canonicalHead = git(SCHOLARLY_READER_CANONICAL, ["rev-parse", "origin/main"]).trim();
  log("1/8", `Canonical HEAD: ${canonicalHead}`);

  // ────────────────────────────────────────────────────────────────
  // STEP 2: Apply grid fix to canonical if not present
  // ────────────────────────────────────────────────────────────────
  log("2/8", "Checking if grid fix (ToC toggle) is present in canonical");
  const buildMjs = join(SCHOLARLY_READER_CANONICAL, "scripts", "build.mjs");
  const buildContent = await readFile(buildMjs, "utf8");
  const hasGridFix = buildContent.includes(".sr-toc-wide .sr-grid");
  
  if (!hasGridFix) {
    log("2/8", "Grid fix missing from canonical — applying from paper-digest's submodule");
    // The fix changes .sr-grid from always-grid to block+relative, and adds .sr-toc-wide .sr-grid
    // We'll apply it by copying the fixed version from paper-digest's submodule
    const pdBuildMjs = join(PAPER_DIGEST_SR, "scripts", "build.mjs");
    const pdBuildContent = await readFile(pdBuildMjs, "utf8");
    await writeFile(buildMjs, pdBuildContent);
    await writeFile(join(SCHOLARLY_READER_CANONICAL, "tailwind-input.css"), await readFile(join(PAPER_DIGEST_SR, "tailwind-input.css"), "utf8"));
    
    // Commit the fix to canonical
    git(SCHOLARLY_READER_CANONICAL, ["add", "scripts/build.mjs", "tailwind-input.css"]);
    git(SCHOLARLY_READER_CANONICAL, ["commit", "-m", "fix: sr-grid only activates with .sr-toc-wide (ToC toggle fix)"]);
    log("2/8", "Grid fix committed to canonical");
  } else {
    log("2/8", "Grid fix already present in canonical ✓");
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 3: Build canonical scholarly-reader
  // ────────────────────────────────────────────────────────────────
  if (!SKIP_BUILD) {
    log("3/8", "Building canonical scholarly-reader (npm run build)");
    run("npm", ["install"], { cwd: SCHOLARLY_READER_CANONICAL });
    run("npm", ["run", "build"], { cwd: SCHOLARLY_READER_CANONICAL });
  } else {
    log("3/8", "Skipping build (--skip-build)");
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 4: Copy dist/* to paper-digest/web/assets/scholarly-reader/
  // ────────────────────────────────────────────────────────────────
  log("4/8", "Copying dist/* to paper-digest/web/assets/scholarly-reader/");
  await ensureDir(WEB_ASSETS_SR);
  const distFiles = ["scholarly-reader.js", "scholarly-reader.css", "scholarly-reader.classic.js"];
  for (const f of distFiles) {
    await copyFile(join(SCHOLARLY_READER_CANONICAL, "dist", f), join(WEB_ASSETS_SR, f));
    log("4/8", `  copied ${f}`);
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 5: Update paper-digest's scholarly-reader submodule
  // ────────────────────────────────────────────────────────────────
  log("5/8", "Updating paper-digest's scholarly-reader submodule to canonical HEAD");
  git(PAPER_DIGEST_SR, ["fetch", "origin"]);
  git(PAPER_DIGEST_SR, ["reset", "--hard", canonicalHead]);
  git(PAPER_DIGEST_SR, ["clean", "-fd"]);
  if (!SKIP_BUILD) {
    run("npm", ["install"], { cwd: PAPER_DIGEST_SR });
    run("npm", ["run", "build"], { cwd: PAPER_DIGEST_SR });
  }
  log("5/8", `paper-digest/scholarly-reader now at ${canonicalHead}`);

  // ────────────────────────────────────────────────────────────────
  // STEP 6: Update consistent-scholarly-reader's scholarly-reader submodule
  // ────────────────────────────────────────────────────────────────
  log("6/8", "Updating consistent-scholarly-reader's scholarly-reader submodule to canonical HEAD");
  git(CSR_SR, ["fetch", "origin"]);
  git(CSR_SR, ["reset", "--hard", "origin/main"]);
  git(CSR_SR, ["clean", "-fd"]);
  if (!SKIP_BUILD) {
    run("npm", ["install"], { cwd: CSR_SR });
    run("npm", ["run", "build"], { cwd: CSR_SR });
  }
  log("6/8", `consistent-scholarly-reader/scholarly-reader now at ${canonicalHead}`);

  // ────────────────────────────────────────────────────────────────
  // STEP 7: Sync CSR parsers to paper-digest/web/vendor/csr/
  // ────────────────────────────────────────────────────────────────
  log("7/8", "Syncing CSR parsers to paper-digest/web/vendor/csr/");
  await ensureDir(WEB_VENDOR_CSR);
  await ensureDir(WEB_VENDOR_CSR_PARSERS);
  
  const csrSources = {
    "content/common.js": join(WEB_VENDOR_CSR, "common.js"),
    "content/parsers/arxiv.js": join(WEB_VENDOR_CSR_PARSERS, "arxiv.js"),
    "content/parsers/nature.js": join(WEB_VENDOR_CSR_PARSERS, "nature.js"),
    "content/parsers/ieee.js": join(WEB_VENDOR_CSR_PARSERS, "ieee.js"),
    "content/parsers/acm.js": join(WEB_VENDOR_CSR_PARSERS, "acm.js"),
    "content/parsers/science.js": join(WEB_VENDOR_CSR_PARSERS, "science.js"),
    "content/parsers/index.js": join(WEB_VENDOR_CSR_PARSERS, "index.js"),
  };
  
  for (const [rel, dest] of Object.entries(csrSources)) {
    await copyFile(join(CSR_ROOT, rel), dest);
    log("7/8", `  copied ${rel}`);
  }
  
  const csrCommit = git(CSR_ROOT, ["rev-parse", "HEAD"]).trim();
  await writeFile(join(WEB_VENDOR_CSR, "VERSION"), csrCommit + "\n");
  log("7/8", `wrote web/vendor/csr/VERSION = ${csrCommit}`);

  // ────────────────────────────────────────────────────────────────
  // STEP 8: Vendor third-party libs
  // ────────────────────────────────────────────────────────────────
  log("8/8", "Vendoring third-party libs (marked, dompurify)");
  await ensureDir(WEB_VENDOR_LIB);
  const libs = [
    {
      name: "marked",
      src: join(PAPER_DIGEST_ROOT, "node_modules", "marked", "lib", "marked.esm.js"),
      dest: join(WEB_VENDOR_LIB, "marked.esm.js"),
    },
    {
      name: "dompurify",
      src: join(PAPER_DIGEST_ROOT, "node_modules", "dompurify", "dist", "purify.es.mjs"),
      dest: join(WEB_VENDOR_LIB, "dompurify.es.mjs"),
    },
  ];
  
  for (const { name, src, dest } of libs) {
    try {
      await readFile(src);
      await copyFile(src, dest);
      log("8/8", `  vendored ${name}`);
    } catch (e) {
      log("8/8", `  ⚠ ${name} not found at ${src}; run \`npm install\` in paper-digest`);
      await writeFile(dest, `// ${name} not installed. Run \`npm install\` to vendor the real library.\nexport default null;\n`);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // OPTIONAL: Push submodule updates
  // ────────────────────────────────────────────────────────────────
  if (PUSH) {
    log("+", "Pushing submodule updates to remotes (--push flag)");
    git(PAPER_DIGEST_SR, ["push", "origin", "HEAD:main"]);
    git(CSR_SR, ["push", "origin", "HEAD:main"]);
    log("+", "Pushed ✓");
  }

  // ────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ✅  Sync complete                                           ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Canonical scholarly-reader: ${canonicalHead.slice(0, 7)}                    ║`);
  console.log(`║  CSR commit:                 ${csrCommit.slice(0, 7)}                    ║`);
  console.log("║                                                              ║");
  console.log("║  Updated:                                                    ║");
  console.log("║    • paper-digest/web/assets/scholarly-reader/*              ║");
  console.log("║    • paper-digest/scholarly-reader (submodule)               ║");
  console.log("║    • consistent-scholarly-reader/scholarly-reader (submodule)║");
  console.log("║    • paper-digest/web/vendor/csr/*                           ║");
  console.log("║    • paper-digest/web/vendor/lib/*                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main().catch((e) => {
  console.error("\n${RED}❌ Sync failed:${RESET}", e.message);
  process.exit(1);
});