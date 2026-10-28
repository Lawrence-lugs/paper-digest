# scholarly-reader

Shared reader for scholarly papers: document structure, theme hooks, table of contents, and reading mark. Consumed by `paper-digest` and `consistent-scholarly-reader` as a git submodule.

## Exports

| Export | Description |
|--------|-------------|
| `CSS` | Compiled stylesheet (placeholder at source, replaced at build) |
| `DEFAULT_UNIT_SELECTOR` | Default block selector for reading units |
| `FONT_URL` | Google Fonts URL for Literata + Instrument Sans |
| `protectMath(source)` | Protect `$$...$$` and `\(...\)` from markdown converter |
| `restoreMath(html, blocks)` | Restore protected math, escaping for safe HTML |
| `createReadingMark(opts)` | Factory for movable reading mark (R to toggle, ↑/↓ or j/k to move) |
| `buildDocument(model, opts)` | Build article DOM (header, sections, ToC, grid) — markup only |
| `mountLayout(root, opts)` | Wire ToC scroll-spy, drawer, toggle button — returns `{ dispose() }` |
| `ensureFonts(doc)` | Inject Google Fonts stylesheet into document (idempotent) |
| `removeFonts(doc)` | Remove injected font stylesheet (idempotent) |

See `CONTRACT.md` for full signatures, option objects, and class names.

## Install

```bash
npm ci
```

## Build

```bash
npm run build
```

Outputs:
- `dist/scholarly-reader.css` — compiled Tailwind stylesheet
- `dist/scholarly-reader.js` — source with `CSS` constant replaced by compiled CSS

The `dist/` folder is committed so submodule consumers can use it without building.

## Consuming as a submodule

```bash
git submodule add <this-repo-url> scholarly-reader
git submodule update --init --recursive
```

In your build, import the bundled JS:

```js
import { buildDocument, mountLayout, createReadingMark, ensureFonts, removeFonts } from "./scholarly-reader/dist/scholarly-reader.js";
```

The CSS is already inlined in the JS bundle via the `CSS` constant. If you need the raw CSS separately, use `dist/scholarly-reader.css`.

## Theme customization

Override these custom properties on `:root` (light DOM) or `:host` (shadow DOM) before the stylesheet loads:

```css
:root {
  --sr-paper: #F2F5F3;
  --sr-ink: #16252C;
  --sr-mute: #5B6C73;
  --sr-rule: #CBD6D3;
  --sr-teal: #0E6B73;
  --sr-gain: #2B7A4B;
  --sr-risk: #A83A2C;
  --sr-warn: #9A6A12;
  --sr-card: #FBFCFB;
}
```

## Pinning

Consumers pin the submodule to a specific commit. Update the pin when you need changes:

```bash
cd scholarly-reader
git pull origin main
cd ..
git add scholarly-reader
git commit -m "scholarly-reader: pin to <new-sha>"
```

## Testing

```bash
npm test
```

Uses `node --test` with jsdom (no browser required). Tests cover DOM logic only — visual layout, sticky positioning, and MathJax rendering are verified manually in R11.