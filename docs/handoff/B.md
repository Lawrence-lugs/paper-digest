# Agent B — Phase 2 handoff: Pipeline

## Context
Phase 0 & 1 are complete. All pipeline tests pass (test/pipeline/pipeline.test.js, 16 tests).
Implementations in web/js/pipeline/ are real (no longer stubs).

## Your Phase 2 task

Work only inside: `web/js/pipeline/`, `web/assets/template.html`, `test/pipeline/`

### 1. CRITICAL BUG FIX — `openInTab` in web/js/pipeline/render.js

Current code (line 416):
```js
const blobUrl = URL.createObjectURL(tab);
```
`tab` is a Window object. Must be:
```js
const blobUrl = URL.createObjectURL(blob);
```
Without this, "Open in new tab" throws TypeError at runtime.

### 2. Cleanup — dead `{{MAP}}` replacement in render.js

Line 262-265:
```js
.split("{{MAP}}").join(JSON.stringify({}))
// ...
html = html.replace("const MAP = {{MAP}};", "const MAP = {};");
```
`{{MAP}}` is already replaced by the split/join above, so the `.replace()` never matches. Remove the dead `.replace()` line (the split/join already produces `const MAP = {};`).

### 3. Add tests to test/pipeline/

Add tests for:
a. `openInTab` — verify it calls `window.open("about:blank", "_blank")`, sets `tab.opener = null`, calls `URL.createObjectURL(blob)` (not tab), and sets `tab.location`. You'll need to shim `window.open`, `URL.createObjectURL`, `URL.revokeObjectURL`. Return `{blocked, tab, blobUrl}`.
b. `downloadHtml` — verify it creates a blob URL, creates an `<a>` with `download` attribute, clicks it, and revokes the URL after ~1s.
c. `copyHtml` — verify `navigator.clipboard.writeText` is called.
d. Render end-to-end: `renderDigest` with a figure containing `$&` in SVG text — assert the output HTML still contains `$&` (no `$` substitution corruption).
e. `buildPrompt` — assert it does NOT contain `figures:` or `baseUrl:` frontmatter keys (carry-over from Phase 1, re-verify).

### 4. Verify
- Run `node --test test/pipeline/` — all tests must pass.
- Do not modify `web/vendor/csr/`, `test/fixtures/`, `package.json`, or `docs/CONTRACTS.md`.

### 5. Reporting
Report: bug fix confirmed, dead code removed, tests added, all tests passed.