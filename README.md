# paper-digest

Static, client-side web app for reading scholarly papers and producing structured digests.
No server process — runs entirely in the browser. Covers three flows:

- **Digest** — ingest a paper (arXiv ID/URL, any URL, pasted HTML, uploaded `.html`), run the LLM digest, open/save/copy the result.
- **Prompt** — ingest a source, copy the master prompt, send it to any chat AI.
- **Template** — paste an AI digest response back in; figures are resolved from the session store (never from the AI's Markdown), then open/save/copy.

## Monorepo Structure

The projects are in the middle of restructuring into a monorepo.
Currently, the top-level project is `paper-digest`. However, there are two subprojects inside:

- `consistent-scholarly-reader`
- `scholarly-reader` - Common dependency of both projects

## How it works

1. **Ingest.** Enter an arXiv ID/URL or any URL, paste raw HTML, or upload a saved `.html` page. The app fetches the page (arXiv IDs become `https://arxiv.org/html/<id>`), parses it with the [consistent-scholarly-reader](https://github.com/Lawrence-lugs/consistent-scholarly-reader) parsers (arXiv, Nature, IEEE, ACM, Science), and produces a `Source`: title, authors, sections, figures (inline SVG or image URLs), and a text summary (`paperText`). Figures and the base URL live in the app's session store, never in the AI's Markdown — this fixes the old template-flow bug where standalone digests had empty figures.

2. **Digest / Prompt.** In Digest mode, the app builds the master prompt (`<notes>`/`<draft>`/`<check>`/`<final>` contract) and sends it to an LLM through an `LLMClient`: OpenRouter (direct from the browser), any OpenAI-compatible base URL (e.g. local Ollama), or an optional local backend. In Prompt mode, no LLM is needed — just copy the prompt and paste the AI's response into Template mode.

3. **Output.** The rendered digest opens in a new tab (Blob URL). "Download .html" and "Copy HTML" are available as alternatives. The output page is self-contained (Tailwind + MathJax from CDN) and includes a sentence-level reading marker.

## Settings

- **API key** is memory-only by default. It lives in a JavaScript variable, not in `localStorage`.
- **"Remember on this device"** is opt-in with a warning: Blob-URL digest pages are same-origin with the app, and the template loads third-party scripts and renders untrusted content, so anything on the page could read `localStorage`. Only enable on a private device.
- Default timeout is 180 s (free models can need a full minute for a 6k-token completion).

## Output filename

`Author-year-journalabbv-shortenedtitle.html` (e.g. `Vaswani-2017-NeurIPS-attention_all_you_need.html`).

## Project structure

```
web/                  app shell (served from /<repo>/web/)
  index.html          HTML shell: loads CSR classic scripts, then the ES module entry
  assets/template.html single source of truth for the digest HTML page
  css/app.css         app styles
  vendor/csr/         CSR parsers (pinned, read-only; synced from the CSR repo)
  vendor/lib/         marked, DOMPurify (vendored, read-only)
  js/ingest/          input resolution, CSR loader, article-to-Source adapter
  js/pipeline/        prompt/digest/render, LLM clients, output helpers
  js/app/             three-mode UI, settings, recent sessions
  js/store/           IndexedDB session store (figures + baseUrl live here)
scripts/
  sync-csr.mjs        sync CSR parsers from the CSR repo (pinned commit in VERSION)
  vendor-libs.mjs     vendor marked + DOMPurify from node_modules
test/{ingest,pipeline,app}/   unit tests per area (node --test)
e2e/                  Playwright end-to-end tests
docs/CONTRACTS.md     frozen layer contracts
docs/handoff/         cross-agent handoff notes
consistent-scholarly-reader/  submodule with the CSR parsers
```

## Development

```bash
# Run all unit tests
npm test            # node --test test/ingest/ test/pipeline/ test/app/

# Per-area
npm run test:ingest
npm run test:pipeline
npm run test:app

# Syntax check
npm run lint        # node --check web/js/**/*.js

# Re-vendor CSR parsers (lead only; requires the CSR repo path)
node scripts/sync-csr.mjs <CSR_REPO_PATH>

# Re-vendor third-party libs (lead only; requires npm install first)
node scripts/vendor-libs.mjs
```

## Deployment

Push to `main` or `web-frontend` — GitHub Actions deploys the `web/` folder to GitHub Pages. The app is served from `/<repo>/`.

## Acceptance criteria (e2e)

See `e2e/` for Playwright tests covering: figure rendering from pasted arXiv HTML, prompt→paste flow with session persistence after IndexedDB clear, fetch-failure fallback UX, Nature/IEEE parsing, no URL-mis-resolution on paste, XSS neutralization (script/onerror/foreignObject/onload), memory-only API key, and `$&` survival in inlined SVG figures.
