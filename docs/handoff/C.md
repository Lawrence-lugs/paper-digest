# Agent C — Phase 2 handoff: App shell + store

## Context
Phase 0 & 1 are complete. Implementations in web/js/app/, web/js/store/, web/index.html, web/css/ are real (no longer stubs).
Missing: `test/app/` directory does not exist.

## Your Phase 2 task

Work only inside: `web/index.html`, `web/css/`, `web/js/app/`, `web/js/store/`, `test/app/`

### 1. Create test/app/ with unit tests

Write tests (Node, no browser needed for store tests; jsdom or linkedom for app UI logic if needed):

a. **`sessions.put` / `sessions.get` / `sessions.list`** — IndexedDB round-trip: put a session, get it by key, list returns it newest-first. Use a real IndexedDB (available in Node via the test environment, or mock it).

b. **`sessionKey`** — `<site>:<primary id>` format: arXiv id version-stripped (`arxiv:2610.17099`), DOI (`acm:10.1145/...`), URL hash fallback, unknown fallback.

c. **`sessions.findByDigest`** — tries normalized id first, then normalized title, returns null when nothing matches. Create sessions with different keys and verify lookup order.

d. **App settings / key memory-only** — verify `saveSettings()` writes the key to localStorage only when "Remember" is checked; verify `loadSettings()` restores it. (May need jsdom shim for localStorage.)

e. **`resolveSourceFromDigest` logic** — verify it returns currentSource if set, else falls back to `sessions.findByDigest`, else null.

### 2. Fix index.html markup

`web/index.html` currently has `</head>` without an opening `<head>`, and no closing `</body>`/`</html>`. Wrap the head content in `<head>...</head>` and add closing tags. Keep all existing elements, IDs, and script load order unchanged.

### 3. Verify integration

- `web/js/app/app.js` imports from `../ingest/ingest.js`, `../pipeline/pipeline.js`, `../pipeline/llm.js`, `../store/sessions.js` — confirm all imports resolve.
- `renderDigest` is called with `{ figures, baseUrl }` from the session store (never from AI Markdown).
- Settings: key is memory-only unless "Remember" checked.

### 4. Verify
- Run `node --test test/ingest/ test/pipeline/ test/app/` — all must pass.
- Do not modify `web/vendor/csr/`, `test/fixtures/`, `package.json`, or `docs/CONTRACTS.md`.

### 5. Reporting
Report: test/app/ created, tests passed, index.html markup fixed, any store.js or app.js changes needed.