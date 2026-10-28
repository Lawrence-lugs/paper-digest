/**
 * scripts/vendor-libs.mjs
 *
 * Vendors the third-party JS libraries the web app needs into web/vendor/lib/
 * (lead-owned; read-only to agents). Copies from node_modules rather than
 * requiring a CDN at runtime, so the app works fully offline after a Pages
 * deploy.
 *
 * Usage:
 *   node scripts/vendor-libs.mjs
 *
 * Copies:
 *   - node_modules/marked/lib/marked.esm.js      -> web/vendor/lib/marked.esm.js
 *   - node_modules/dompurify/dist/purify.es.js   -> web/vendor/lib/dompurify.es.js
 *
 * Prints a warning (and continues) for any library that isn't installed yet;
 * run `npm install` first if a library is missing.
 */

import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
// In a monorepo with workspaces, node_modules is at the repo root
const NODE_MODULES = join(ROOT, "..", "..", "node_modules");
const DEST_DIR = join(ROOT, "web", "vendor", "lib");

const LIBS = [
  {
    name: "marked",
    src: join(NODE_MODULES, "marked", "lib", "marked.esm.js"),
    dest: join(DEST_DIR, "marked.esm.js"),
  },
  {
    name: "dompurify",
    src: join(NODE_MODULES, "dompurify", "dist", "purify.es.mjs"),
    dest: join(DEST_DIR, "dompurify.es.mjs"),
  },
];

async function main() {
  await mkdir(DEST_DIR, { recursive: true });
  for (const { name, src, dest } of LIBS) {
    let ok = false;
    try {
      await readFile(src); // ensure it exists
      await copyFile(src, dest);
      ok = true;
      console.log(`vendored ${name} -> ${dest}`);
    } catch (e) {
      console.warn(`[vendor-libs] ${name} not found at ${src}; run \`npm install\``);
    }
    if (!ok) {
      // Placeholder so import paths still resolve before install.
      await writeFile(dest, `// ${name} not installed. Run \`npm install\` to vendor the real library.\nexport default null;\n`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
