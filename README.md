
# Paper Digest Generator

Reduce token waste of paper digests by outsourcing the template to a JSON-into-HTML creation pipeline.

## Workflow

1. **Input** — HTML, PDF, or a link (arXiv / Semantic Scholar / any URL).
2. **Fetch** — links are resolved via the arXiv HTML version (`https://arxiv.org/html/<id>`) or fetched directly; raw HTML and local PDFs are accepted.
3. **Digest** — the source text goes to an OpenRouter agent governed by the master prompt (`src/prompt.js`). The agent returns a **JSON** digest (not HTML): verdict, motivation, core idea, distinguishing factor, evaluation, ICYMI, cautious judgement, sources/limits.
4. **Template** — the JSON digest is rendered into `assets/template.html` (self-contained Tailwind + MathJax + sentence-level reading marker) and written to `outputs/<Author-year-journalabbv-shortenedtitle.html>`.

## CLI

The CLI has three modes. `source` may be an arXiv id/link, a URL, raw HTML text, or a local PDF path.

### 1. `prompt` — emit the master prompt (no LLM)

```
paper-digest prompt <source> [--out <file>]
```

Fetches the source and prints the **master prompt** (the agent instructions that demand JSON output). Copy/paste this into any chat AI; the AI returns the digest JSON, which you then feed to `template`. Use this when you want a chat AI to do the digesting.

### 2. `digest` — full pipeline (fetch → OpenRouter agent → HTML)

```
paper-digest digest <source> [--out <dir>]
```

Fetches the source, runs the OpenRouter agent (`src/llm.js` follows the reference Python `LLM` class), parses the JSON digest, saves the intermediate `<name>.json`, and renders `<name>.html` to `--out` (default `outputs/`).

### 3. `template` — JSON already written, just render to HTML

```
paper-digest template <digest.json> [--out <dir>]
```

Takes an already-written digest JSON (e.g. produced by a chat AI from `prompt`) and renders it into the self-contained HTML template. No LLM call, no network fetch.

Output filename convention (all modes):

`Author-year-journalabbv-shortenedtitle.html`

(e.g. `Vaswani-2017-NeurIPS-attention_all_you_need.html`). Outputs are git-ignored.

## UI / preview

- `ui/index.html` — standalone browser UI. Paste a digest JSON (from `prompt` or a chat AI), tweak BASE URL / figures, and preview the rendered HTML. Copy or save the result.
- `ui/obsidian-dataviewjs.js` — self-contained Obsidian DataviewJS snippet. Drop it into a dataviewjs code block to render a digest JSON file inline in a vault note:

  ```dataviewjs
  let digestPath = dv.current().file.folder + "/Vaswani-2017-Neurips-attention_all_you_need.json";
  await renderPaperDigest(dv, container, digestPath);
  ```

  It embeds the same pure render logic as `src/render.js` (no Node, no network), so it works inside Obsidian.

## Configuration (OpenRouter)

The `digest` mode uses [OpenRouter](https://openrouter.ai). Provide an API key via one of:

- `OPENROUTER_API_KEY` environment variable, or
- `~/.paper_digest_key` file containing the key.

Configure models and limits in `paper-digest.config.json` (copy `paper-digest.config.json.example`):

```json
{
  "models": ["meta-llama/llama-3.2-3b-instruct"],
  "temperature": 0.2,
  "max_tokens": 2048,
  "retries": 2,
  "max_requests_per_run": 50,
  "timeout_s": 30
}
```

Env overrides: `PAPER_DIGEST_MODEL`. Models are tried in order; each is retried before falling back to the next. A 401 aborts immediately; 400/402/403/404 skip to the next model; 429 honors `Retry-After`.

Example:

```sh
export OPENROUTER_API_KEY=sk-or-...
paper-digest https://arxiv.org/abs/1706.03762 --out outputs
```

## Project structure

- `src/fetch.js` — source resolver (arXiv / URL / HTML / PDF) + figure map extraction
- `src/prompt.js` — master prompt; agent emits JSON
- `src/llm.js` — OpenRouter client (key loading, model fallbacks, retries, per-run cap)
- `src/digest.js` — agent orchestration
- `src/template.js` — JSON → HTML renderer
- `src/cli.js` — CLI entry point
- `assets/template.html` — self-contained digest template
