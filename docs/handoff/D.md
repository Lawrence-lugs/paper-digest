# Agent D — Phase 2 handoff: E2E (Playwright)

## Context
Phase 0 & 1 are complete. The web app exists at `web/` and all unit tests pass.
Missing: `e2e/` directory does not exist. No Playwright tests.

## Your Phase 2 task

Work only inside: `e2e/`

### 1. Create e2e/ Playwright test suite

Set up a local static server serving `web/` (e.g., `npx http-server web/` or a Node http server) and write Playwright tests covering these acceptance criteria:

**AC1 — Pasted arXiv HTML + mocked OpenRouter → new-tab page, every figure shows image or inline SVG.**
- Serve the arXiv fixture HTML at a mock URL.
- Mock OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`) to return a valid digest response with `<final>`.
- Ingest the URL, run digest, open in new tab.
- Assert the new tab page contains the inlined figure (img or svg) for every figure.

**AC2 — Prompt flow: "Copy prompt", paste AI response, figures resolve.**
- Ingest a source, copy the prompt.
- Paste an AI digest response (with `<figure data-n="1" ...>` tags) into Template mode.
- Render, assert figures appear.
- Reload the page, open the session from "Recent sessions", assert template-only input finds the session by id.
- Clear IndexedDB (via page evaluate `indexedDB.deleteDatabase('paper-digest')`), re-render, assert figures render as "Open Fig. N" links, never blank.

**AC3 — Mocked fetch failure reveals upload + paste panels with explanation.**
- Mock `fetch` to fail for a URL.
- Ingest that URL.
- Assert the error panel shows a plain-language explanation and upload/paste are available.

**AC4 — Nature + IEEE fixtures parse; sections + figures appear in Source; IEEE fallback flagged abstract-only.**
- Load the CSR nature.html and ieee.html fixtures.
- Assert `site`, section count > 0, figure count, and `whatRead` contains "abstract only" for IEEE.

**AC5 — Paste with no URL: relative image URLs are not resolved against app origin.**
- Paste HTML with `<img src="fig1.png">` and no URL hints.
- Assert no figure URL contains the app's origin (e.g., no `localhost` or `github.io`).

**AC6 — XSS neutralization.**
- Digest containing `<script>`, `onerror`, and SVG figure with `<script>`, `foreignObject`, `onload`.
- Assert all are neutralized in output page (no `<script>`, no `onerror`, no `foreignObject`, no `onload`).

**AC7 — API key absent from localStorage/sessionStorage unless "Remember" checked.**
- Open Settings, enter a key without "Remember".
- Assert key not in localStorage/sessionStorage.
- Check "Remember", assert key IS in localStorage.

**AC8 — Figure SVG containing `$&` survives inlining intact.**
- Render a digest whose figure SVG has text `cost $& and $$`.
- Assert output HTML contains `$&` and `$$` unchanged.

### 2. Verify
- Run Playwright tests against the local static server.
- All 8 e2e cases must pass.

### 3. Constraints
- Do not edit other agents' files (web/js/*, test/*, scripts/*, docs/CONTRACTS.md).
- If a test fails due to a bug in another agent's code, report it in `docs/handoff/e2e.md` — do not fix it yourself.

### 4. Reporting
Report: e2e/ created, all 8 cases passed (or failures documented in docs/handoff/e2e.md).