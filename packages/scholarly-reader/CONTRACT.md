# scholarly-reader Contract

This document describes the **actual** exports from `src/scholarly-reader.js` as of the current implementation. It is the source of truth for both consumers (`paper-digest` and `consistent-scholarly-reader`).

---

## Exports

### `CSS` (constant)
- **Type**: `string`
- **Value**: `""` (placeholder)
- **Purpose**: Replaced at build time with the compiled Tailwind CSS. Consumers import the built `dist/scholarly-reader.js` where this constant contains the full stylesheet.

---

### `DEFAULT_UNIT_SELECTOR` (constant)
- **Type**: `string`
- **Value**: `"p, li, blockquote, figcaption, td"`
- **Purpose**: Default CSS selector for block elements that become reading units.

---

### `FONT_URL` (constant)
- **Type**: `string`
- **Value**: `"https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600&family=Instrument+Sans:wght@400;600&display=swap"`
- **Purpose**: Google Fonts URL for Literata (serif) and Instrument Sans (sans-serif). Used by `ensureFonts()`.

---

### `protectMath(source: string) => { text: string, blocks: string[] }`
Protects math delimiters (`$$...$$` and `\(...\)`) so a markdown converter leaves them untouched. Only these two forms count as math; a lone `$` is treated as literal text (currency-safe).

- **Parameters**:
  - `source` — input text (may be `null`/`undefined`, treated as empty string)
- **Returns**:
  - `text` — source with math replaced by `\x00MATH<n>\x00` placeholders
  - `blocks` — array of protected math strings, each wrapped as `\\[...\\]` or `\\(...\\)`

---

### `restoreMath(html: string, blocks: string[]) => string`
Restores protected math into HTML, escaping the math text so it cannot break surrounding markup. MathJax reads the unescaped text from the DOM.

- **Parameters**:
  - `html` — HTML string containing `\x00MATH<n>\x00` placeholders
  - `blocks` — array returned by `protectMath`
- **Returns**: HTML with placeholders replaced by escaped math

---

### `createReadingMark(opts: object) => ReadingMarkController`
Factory for a movable highlighted reading unit (sentence or display equation). Activated with `R`, moved with `Up`/`Down` or `j`/`k`, exited with `Esc` or `R` again, or by clicking a unit directly.

#### Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `container` | `Element` | **required** | Element whose descendant units are read |
| `scroller` | `Window \| Element` | `window` | Element that scrolls (window or a scroll container) |
| `unitSelector` | `string` | `DEFAULT_UNIT_SELECTOR` | Block selector for units |
| `activeTarget` | `Element` | `container` | Element that receives the `sr-active` class |
| `hintParent` | `Element` | `activeTarget` | Element that receives the key hint (`sr-hint`) |
| `keyTarget` | `Element \| Document` | `document` | Where `keydown` is listened for |
| `onUnitChange` | `function(Element): void` | `null` | Called with the unit each time the mark lands on one |
| `topInset` | `number` | `96` | Pixels below viewport top a unit must clear to be "first" |
| `window` | `Window` | `container.ownerDocument.defaultView` | Window used for scrolling and geometry |

#### Returned Controller
```ts
{
  get units(): Element[];        // current unit elements
  get idx(): number;             // current unit index (-1 = none)
  get active(): boolean;         // whether the mark is active
  attach(): void;                // discover units, bind listeners
  detach(): void;                // remove listeners, clear state
  activate(i?: number): void;    // turn on, optionally at index i
  deactivate(): void;            // turn off
}
```

#### Behaviour notes
- Units are `span.sr-unit` (sentences) or display math elements with `sr-unit` class added.
- `attach()` is idempotent (calling twice detaches first).
- `activate()`/`deactivate()` are idempotent.
- The `sr-hint` element shows "R: reading marker" when inactive, "↑ ↓ move · Esc exit" when active.
- Clicking a unit activates the mark at that unit; clicking again moves the mark.

---

### `buildDocument(model: object, opts: object) => { root, page, main, toc, tocButton }`
Builds the complete article DOM structure: header, sections, table of contents, and layout grid. **Markup only** — no listeners, no layout reads. Call `mountLayout()` on the returned `root` once it is in a document.

#### Model
```ts
{
  header?: {
    kicker?: string;
    kickerHref?: string;
    title: string;
    authors?: string;
    verdict?: { text?: string; badge?: Badge };
  };
  sections?: Section[];
  figures?: Figure[];
}
```

#### Section
```ts
{
  id?: string;
  title: string;
  badge?: Badge;
  blocks: Block[];
}
```

#### Figure
```ts
{
  n: string | number;      // figure number
  dataA?: string;          // anchor for fallback link
  caption?: string;
  url?: string;            // raster image URL
  svg?: string;            // inline SVG markup
}
```

#### Block types
| Type | Fields | Description |
|------|--------|-------------|
| `markdown` | `{ text: string }` | Markdown → HTML via `opts.markdown` |
| `items` | `{ items: Item[] }` | List of items with optional badge |
| `table` | `{ head?: Cell[], rows: Cell[][] }` | Table with optional header |
| `html` | `{ html: string }` | Pre-sanitized HTML |
| `figure` | `{ n: string \| number }` | Resolved against `model.figures` |
| `nodes` | `{ nodes: Node[] }` | Live DOM nodes passed through by reference |

#### Item
```ts
{ markdown?: string; text?: string; badge?: Badge }
```

#### Cell
```ts
string | { markdown?: string; badge?: Badge }
```

#### Badge
```ts
{ tone: "pos" | "neg" | "neu" | "accent"; label?: string }
```
Tone maps to class `sr-badge sr-tone-<tone>`.

#### Options
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `document` | `Document` | **yes** | Document to build into |
| `markdown` | `(src: string) => string` | for markdown blocks | Markdown → HTML converter |
| `sanitize` | `(html: string, {svg?: boolean}) => string` | for markdown & html blocks | HTML sanitizer (DOMPurify profile) |

#### Returned object
```ts
{
  root: HTMLDivElement;      // .sr-root (grid container)
  page: HTMLDivElement;      // .sr-page (centred column + toggle button)
  main: HTMLElement;         // .sr-main (article content)
  toc: HTMLNavElement | null; // .sr-toc (present when ≥2 headings)
  tocButton: HTMLButtonElement | null; // .sr-toc-btn
}
```

#### Class names used
- Layout: `sr-root`, `sr-grid`, `sr-page`, `sr-main`, `sr-header`, `sr-title`, `sr-authors`, `sr-verdict`, `sr-kicker`, `sr-kicker-link`, `sr-h2`, `sr-item`, `sr-table-wrap`, `sr-figure`, `sr-toc`, `sr-toc-title`, `sr-toc-link`, `sr-toc-sub`, `sr-toc-btn`, `sr-toc-wide`, `sr-toc-open`, `sr-toc-current`
- Badges: `sr-badge`, `sr-tone-pos`, `sr-tone-neg`, `sr-tone-neu`, `sr-tone-accent`
- Reading mark: `sr-unit`, `sr-on`, `sr-active`, `sr-hint`

---

### `mountLayout(root: Element, opts: object) => { dispose(): void }`
Wires the table of contents: scroll-spy, drawer for narrow widths, and the Contents toggle button.

#### Options
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `window` | `Window` | `root.ownerDocument.defaultView` | Window for geometry |
| `scroller` | `Window \| Element` | `window` | Element that scrolls |

#### Behaviour
- Scroll-spy highlights the last heading above a line 90px from the top of the scroller.
- At scroll bottom, the last heading is forced active.
- The ToC appears in the left margin when there is room (≥ 16.5rem), otherwise it becomes a drawer toggled by `.sr-toc-btn`.
- `ResizeObserver` on `root` toggles `.sr-toc-wide` based on available margin.
- Wheel events on the ToC pass through to the article when the ToC doesn't scroll.
- Returns `{ dispose() }` to clean up all listeners and observers.

---

### `ensureFonts(doc: Document) => void`
Injects the Google Fonts stylesheet (`FONT_URL`) and a preconnect link into `doc.head`. Idempotent — does nothing if `#sr-fonts` already exists.

---

### `removeFonts(doc: Document) => void`
Removes the font stylesheet and preconnect link (`#sr-fonts`, `#sr-fonts-preconnect`) from `doc.head`. Idempotent.

---

## Theme Custom Properties

The built stylesheet defines these on `:root` and `:host` (for shadow DOM):

| Property | Fallback in template | Description |
|----------|---------------------|-------------|
| `--sr-paper` | `#F2F5F3` | Page background |
| `--sr-ink` | `#16252C` | Primary text |
| `--sr-mute` | `#5B6C73` | Muted text |
| `--sr-rule` | `#CBD6D3` | Rules/borders |
| `--sr-teal` | `#0E6B73` | Accent (headings, links) |
| `--sr-gain` | `#2B7A4B` | Positive badge |
| `--sr-risk` | `#A83A2C` | Negative badge |
| `--sr-warn` | `#9A6A12` | Neutral badge |
| `--sr-card` | `#FBFCFB` | Card/figure background |

Consumers may override these before the stylesheet loads, or via `:root` in their own CSS.

---

## Class Name Prefix

All shared classes use the `sr-` prefix. Consumers must not define conflicting `sr-*` classes.

---

## Versioning

The contract is versioned by the `scholarly-reader` git commit SHA. Consumers pin the submodule to a specific commit. Any change to the exports above requires a pin bump in both consumers.