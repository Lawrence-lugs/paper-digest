# Agent A — Phase 2 handoff: Ingest

## Context
Phase 0 & 1 are complete. All ingest tests pass (test/ingest/ingest.test.js, 12 tests).
The implementations in web/js/ingest/ingest.js are real (no longer stubs).

## Your Phase 2 task

Work only inside: `web/js/ingest/`, `test/ingest/`

### 1. Extend test/ingest/ with the following additions

Add tests (using the existing linkedom + runInThisContext CSR loader pattern):

a. **`ingest()` end-to-end with `kind: 'url'`** against the arxiv fixture HTML — mock `globalThis.fetch` to return the fixture text, assert the returned `Source` has `site === "arxiv"`, `key === "arxiv:2610.17099"`, `paperText` contains the title, `figures.length === 1`, `figures[0].dataA === "S2.F1"`.

b. **`ingest()` with `kind: 'html'` (paste)** — paste the arxiv fixture HTML with no URL, assert `baseUrl === null`, figure `url === ""` (relative URLs dropped, not mis-resolved against app origin — assert no `github.io` or `localhost` in any figure URL).

c. **`ingest()` with `kind: 'csr-json'`** — pass a CSR Article-shaped JSON object, assert it converts to a `Source` with `site` and `key` set correctly.

d. **`FetchBlockedError`** — mock `fetch` to reject, assert `ingest({kind:'url', value:'https://example.com/x'})` throws a `FetchBlockedError` with `.url` and `.reason` set.

e. **URL inference order** — already covered, but add a case where `citation_arxiv_id` synthesizes `https://arxiv.org/html/<id>` and the arxiv parser then fires via sniff (no URL).

### 2. Verify
- Run `node --test test/ingest/` — all tests must pass.
- Do not modify `web/vendor/csr/`, `test/fixtures/`, `package.json`, or `docs/CONTRACTS.md`.

### 3. Reporting
Report: tests added, tests passed, any ingest.js changes needed (none expected).