/**
 * Local static server for the Phase 2 E2E suite.
 *
 * Serves:
 *  - `web/` at the root (the app itself: index.html, css/, js/, vendor/)
 *  - `assets/` at /assets/ (template.html fetched by web/js/pipeline/render.js)
 *  - `test/fixtures/csr/` plus `e2e/fixtures/` at /mock/ (fixture pages ingested
 *    at mock URLs, e.g. http://127.0.0.1:8910/mock/arxiv.html)
 *
 * Usage: node e2e/server.cjs   (listens on 127.0.0.1:8910)
 */

const { createServer } = require("node:http");
const { readFile, stat } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");

const ROOT = resolve(join(__dirname, ".."));
const WEB = join(ROOT, "packages", "paper-digest-app", "web");
const ASSETS = join(WEB, "assets");
const E2E_FIXTURES = join(ROOT, "e2e", "fixtures");
const CSR_FIXTURES = join(ROOT, "packages", "paper-digest-app", "test", "fixtures", "csr");
const PORT = 8910;
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};

/** Resolve `filePath` inside `root`, never escaping it. */
function safeJoin(root, filePath) {
  const resolved = resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error("path escapes root");
  }
  return resolved;
}

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath;

  try {
    if (url.pathname === "/" || url.pathname === "") {
      filePath = join(WEB, "index.html");
    } else if (url.pathname.startsWith("/assets/")) {
      filePath = safeJoin(ASSETS, url.pathname.slice("/assets/".length));
    } else if (url.pathname.startsWith("/mock/")) {
      const name = url.pathname.slice("/mock/".length);
      try {
        filePath = safeJoin(E2E_FIXTURES, name);
        await stat(filePath);
      } catch (_) {
        filePath = safeJoin(CSR_FIXTURES, name);
      }
    } else {
      // url.pathname is absolute ("/css/app.css"); join() keeps it relative
      // to WEB (resolve() would restart from the pathname root).
      filePath = safeJoin(WEB, url.pathname.replace(/^\/+/, ""));
    }
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("bad request");
    return;
  }

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch (_) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

createServer(serve).listen(PORT, HOST, () => {
  console.log(`[e2e static server] http://${HOST}:${PORT}/  (web/ at root, /assets/, /mock/)`);
});
