(function (global) {
  var ScholarlyReader = {};
// Shared reader for scholarly papers: document structure, theme hooks, the
// table of contents and the reading mark. No runtime dependencies. Callers
// inject the markdown converter, the HTML sanitizer and the document they
// build into, so the same code runs on a generated page (paper-digest) and
// on live publisher nodes (consistent-scholarly-reader).
//
// dist/ is generated from this file by scripts/build.mjs. Keep every export
// a top-level `export function|const`; the classic build relies on that.

const CSS = "*, ::before, ::after {\n  --tw-border-spacing-x: 0;\n  --tw-border-spacing-y: 0;\n  --tw-translate-x: 0;\n  --tw-translate-y: 0;\n  --tw-rotate: 0;\n  --tw-skew-x: 0;\n  --tw-skew-y: 0;\n  --tw-scale-x: 1;\n  --tw-scale-y: 1;\n  --tw-pan-x:  ;\n  --tw-pan-y:  ;\n  --tw-pinch-zoom:  ;\n  --tw-scroll-snap-strictness: proximity;\n  --tw-gradient-from-position:  ;\n  --tw-gradient-via-position:  ;\n  --tw-gradient-to-position:  ;\n  --tw-ordinal:  ;\n  --tw-slashed-zero:  ;\n  --tw-numeric-figure:  ;\n  --tw-numeric-spacing:  ;\n  --tw-numeric-fraction:  ;\n  --tw-ring-inset:  ;\n  --tw-ring-offset-width: 0px;\n  --tw-ring-offset-color: #fff;\n  --tw-ring-color: rgb(59 130 246 / 0.5);\n  --tw-ring-offset-shadow: 0 0 #0000;\n  --tw-ring-shadow: 0 0 #0000;\n  --tw-shadow: 0 0 #0000;\n  --tw-shadow-colored: 0 0 #0000;\n  --tw-blur:  ;\n  --tw-brightness:  ;\n  --tw-contrast:  ;\n  --tw-grayscale:  ;\n  --tw-hue-rotate:  ;\n  --tw-invert:  ;\n  --tw-saturate:  ;\n  --tw-sepia:  ;\n  --tw-drop-shadow:  ;\n  --tw-backdrop-blur:  ;\n  --tw-backdrop-brightness:  ;\n  --tw-backdrop-contrast:  ;\n  --tw-backdrop-grayscale:  ;\n  --tw-backdrop-hue-rotate:  ;\n  --tw-backdrop-invert:  ;\n  --tw-backdrop-opacity:  ;\n  --tw-backdrop-saturate:  ;\n  --tw-backdrop-sepia:  ;\n  --tw-contain-size:  ;\n  --tw-contain-layout:  ;\n  --tw-contain-paint:  ;\n  --tw-contain-style:  ;\n}\n\n::backdrop {\n  --tw-border-spacing-x: 0;\n  --tw-border-spacing-y: 0;\n  --tw-translate-x: 0;\n  --tw-translate-y: 0;\n  --tw-rotate: 0;\n  --tw-skew-x: 0;\n  --tw-skew-y: 0;\n  --tw-scale-x: 1;\n  --tw-scale-y: 1;\n  --tw-pan-x:  ;\n  --tw-pan-y:  ;\n  --tw-pinch-zoom:  ;\n  --tw-scroll-snap-strictness: proximity;\n  --tw-gradient-from-position:  ;\n  --tw-gradient-via-position:  ;\n  --tw-gradient-to-position:  ;\n  --tw-ordinal:  ;\n  --tw-slashed-zero:  ;\n  --tw-numeric-figure:  ;\n  --tw-numeric-spacing:  ;\n  --tw-numeric-fraction:  ;\n  --tw-ring-inset:  ;\n  --tw-ring-offset-width: 0px;\n  --tw-ring-offset-color: #fff;\n  --tw-ring-color: rgb(59 130 246 / 0.5);\n  --tw-ring-offset-shadow: 0 0 #0000;\n  --tw-ring-shadow: 0 0 #0000;\n  --tw-shadow: 0 0 #0000;\n  --tw-shadow-colored: 0 0 #0000;\n  --tw-blur:  ;\n  --tw-brightness:  ;\n  --tw-contrast:  ;\n  --tw-grayscale:  ;\n  --tw-hue-rotate:  ;\n  --tw-invert:  ;\n  --tw-saturate:  ;\n  --tw-sepia:  ;\n  --tw-drop-shadow:  ;\n  --tw-backdrop-blur:  ;\n  --tw-backdrop-brightness:  ;\n  --tw-backdrop-contrast:  ;\n  --tw-backdrop-grayscale:  ;\n  --tw-backdrop-hue-rotate:  ;\n  --tw-backdrop-invert:  ;\n  --tw-backdrop-opacity:  ;\n  --tw-backdrop-saturate:  ;\n  --tw-backdrop-sepia:  ;\n  --tw-contain-size:  ;\n  --tw-contain-layout:  ;\n  --tw-contain-paint:  ;\n  --tw-contain-style:  ;\n}\n\n:root,\n  :host {\n  --sr-paper: #F2F5F3;\n  --sr-ink: #16252C;\n  --sr-mute: #5B6C73;\n  --sr-rule: #CBD6D3;\n  --sr-teal: #0E6B73;\n  --sr-gain: #2B7A4B;\n  --sr-risk: #A83A2C;\n  --sr-warn: #9A6A12;\n  --sr-card: #FBFCFB;\n}\n\n* {\n  box-sizing: border-box;\n}\n\nhtml {\n  font-family: var(--font-serif);\n  line-height: 1.65;\n  background: var(--sr-paper);\n  color: var(--sr-ink);\n}\n\n:host {\n  all: initial;\n  display: block;\n}\n\n.\\!container {\n  width: 100% !important;\n}\n\n.container {\n  width: 100%;\n}\n\n@media (min-width: 640px) {\n  .\\!container {\n    max-width: 640px !important;\n  }\n\n  .container {\n    max-width: 640px;\n  }\n}\n\n@media (min-width: 768px) {\n  .\\!container {\n    max-width: 768px !important;\n  }\n\n  .container {\n    max-width: 768px;\n  }\n}\n\n@media (min-width: 1024px) {\n  .\\!container {\n    max-width: 1024px !important;\n  }\n\n  .container {\n    max-width: 1024px;\n  }\n}\n\n@media (min-width: 1280px) {\n  .\\!container {\n    max-width: 1280px !important;\n  }\n\n  .container {\n    max-width: 1280px;\n  }\n}\n\n@media (min-width: 1536px) {\n  .\\!container {\n    max-width: 1536px !important;\n  }\n\n  .container {\n    max-width: 1536px;\n  }\n}\n\n.sr-grid {\n  display: block;\n  position: relative;\n  min-height: 100%;\n}\n\n.sr-page {\n  min-width: 0;\n}\n\n.sr-toc-wide .sr-grid {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) minmax(0, 4fr);\n  gap: 1.5rem;\n}\n\n.sr-toc-wide .sr-page {\n  grid-column: 2;\n}\n\n.sr-main {\n  max-width: 72ch;\n  margin: 0 auto;\n  padding: 2.5rem 1.25rem;\n}\n\n.sr-header {\n  margin-bottom: 1.5rem;\n}\n\n.sr-title {\n  font-family: var(--font-sans);\n  font-weight: 600;\n  font-size: 1.8rem;\n  line-height: 1.25;\n  margin: 0.3rem 0;\n}\n\n.sr-authors {\n  font-family: var(--font-sans);\n  font-size: 0.95rem;\n  color: var(--sr-mute);\n  margin: 0 0 1rem;\n}\n\n.sr-kicker {\n  font-family: var(--font-sans);\n  font-size: 0.85rem;\n  color: var(--sr-mute);\n  margin: 0;\n}\n\n.sr-kicker-link {\n  color: inherit;\n  text-decoration: underline;\n  cursor: pointer;\n}\n\n.sr-verdict {\n  margin-top: 1rem;\n}\n\n.sr-verdict b {\n  font-weight: 600;\n}\n\n.sr-h2 {\n  font-family: var(--font-sans);\n  font-weight: 600;\n  font-size: 1.3rem;\n  border-left: 4px solid var(--sr-teal);\n  padding-left: 0.7rem;\n  margin: 2.2rem 0 0.8rem;\n  scroll-margin-top: 1rem;\n}\n\n.sr-item {\n  border-bottom: 1px solid var(--sr-rule);\n  padding: 0.7rem 0;\n  max-width: 72ch;\n}\n\n.sr-table-wrap {\n  overflow-x: auto;\n  margin: 1rem 0;\n}\n\n.sr-table-wrap table {\n  border-collapse: collapse;\n  width: 100%;\n  font-size: 0.88rem;\n}\n\n.sr-table-wrap th,\n  .sr-table-wrap td {\n  border-bottom: 1px solid var(--sr-rule);\n  padding: 0.45rem 0.5rem;\n  text-align: left;\n  vertical-align: top;\n}\n\n.sr-table-wrap th {\n  font-family: var(--font-sans);\n  font-weight: 600;\n  color: var(--sr-mute);\n}\n\n.sr-figure {\n  background: var(--sr-card);\n  border: 1px solid var(--sr-rule);\n  padding: 0.6rem;\n  margin: 1.4rem 0;\n  max-width: 100%;\n  overflow-x: auto;\n}\n\n.sr-figure img,\n  .sr-figure svg {\n  display: block;\n  width: 100%;\n  height: auto;\n  margin: 0;\n}\n\n.sr-figure figcaption {\n  font-size: 0.8rem;\n  color: var(--sr-mute);\n  margin-top: 0.4rem;\n}\n\n.sr-toc {\n  position: absolute;\n  top: 4.25rem;\n  left: 1rem;\n  width: 14rem;\n  max-height: calc(100% - 5.75rem);\n  overflow-y: auto;\n  font-family: var(--font-sans);\n  font-size: 0.82rem;\n  line-height: 1.35;\n  display: none;\n}\n\n.sr-toc-title {\n  font-size: 0.7rem;\n  font-weight: 600;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: var(--sr-mute);\n  margin: 0 0 0.6rem 0.6rem;\n}\n\n.sr-toc ul {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n}\n\n.sr-toc-link {\n  display: block;\n  padding: 0.28rem 0.6rem;\n  color: var(--sr-mute);\n  text-decoration: none;\n  border-left: 2px solid var(--sr-rule);\n}\n\n.sr-toc-link:hover {\n  color: var(--sr-ink);\n  background: rgba(22, 37, 44, 0.04);\n}\n\n.sr-toc-sub {\n  padding-left: 1.3rem;\n  font-size: 0.78rem;\n}\n\n.sr-toc-link.active,\n  .sr-toc-link[aria-current] {\n  color: var(--sr-teal);\n  border-left-color: var(--sr-teal);\n  font-weight: 600;\n}\n\n.sr-toc-btn {\n  display: none;\n  -webkit-appearance: none;\n     -moz-appearance: none;\n          appearance: none;\n  border: 1px solid var(--sr-rule);\n  background: var(--sr-card);\n  border-radius: 6px;\n  height: 1.8rem;\n  padding: 0 0.6rem;\n  cursor: pointer;\n  font: inherit;\n  color: var(--sr-ink);\n}\n\n.sr-toc-wide .sr-toc {\n  display: block;\n}\n\n.sr-root:not(.sr-toc-wide) .sr-toc-btn {\n  display: inline-block;\n}\n\n.sr-root:not(.sr-toc-wide).sr-toc-open .sr-toc {\n  display: block;\n  top: 3.1rem;\n  left: 0;\n  bottom: 0;\n  width: 17rem;\n  max-height: none;\n  background: var(--sr-card);\n  border-right: 1px solid var(--sr-rule);\n  padding: 1rem;\n  z-index: 2;\n  box-shadow: 4px 0 14px rgba(22, 37, 44, 0.12);\n}\n\n.sr-badge {\n  font-family: var(--font-sans);\n  font-size: 0.75rem;\n  font-weight: 600;\n  border-radius: 999px;\n  padding: 0.05rem 0.5rem;\n  margin-left: 0.5rem;\n  white-space: nowrap;\n  vertical-align: middle;\n  border: 1px solid;\n}\n\n.sr-unit {\n  box-decoration-break: clone;\n  -webkit-box-decoration-break: clone;\n  border-radius: 3px;\n}\n\n.sr-on {\n  background: rgba(22, 37, 44, 0.15);\n  box-shadow: 0 0 0 2px rgba(22, 37, 44, 0.15);\n}\n\n.sr-active .sr-unit:hover:not(.sr-on) {\n  background: rgba(22, 37, 44, 0.06);\n}\n\n.sr-hint {\n  position: fixed;\n  right: 0.8rem;\n  bottom: 0.7rem;\n  font: 600 0.7rem var(--font-sans);\n  color: var(--sr-mute);\n  background: var(--sr-card);\n  border: 1px solid var(--sr-rule);\n  border-radius: 6px;\n  padding: 0.2rem 0.55rem;\n  opacity: 0.9;\n  pointer-events: none;\n}\n\n@media print {\n  .sr-on {\n    background: none;\n    box-shadow: none;\n  }\n\n  .sr-hint {\n    display: none;\n  }\n}\n\n.sr-page p,\n  .sr-page li,\n  .sr-page .sr-item,\n  .sr-page blockquote {\n  text-align: justify;\n  text-justify: inter-word;\n  hyphens: auto;\n  -webkit-hyphens: auto;\n  overflow-wrap: break-word;\n}\n\n.sr-page blockquote {\n  border-left: 3px solid var(--sr-rule);\n  padding-left: 1rem;\n  color: var(--sr-mute);\n  margin: 1.1rem 0;\n}\n\n.sr-page a {\n  color: var(--sr-teal);\n}\n\n.block {\n  display: block;\n}\n\n.table {\n  display: table;\n}\n\n.grid {\n  display: grid;\n}\n\n.contents {\n  display: contents;\n}\n\n.hidden {\n  display: none;\n}\n\n.shadow {\n  --tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);\n  --tw-shadow-colored: 0 1px 3px 0 var(--tw-shadow-color), 0 1px 2px -1px var(--tw-shadow-color);\n  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);\n}\n";

const DEFAULT_UNIT_SELECTOR = "p, li, blockquote, figcaption, td";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600&family=Instrument+Sans:wght@400;600&display=swap";

const DISPLAY_MATH = "math[display='block'], mjx-container[display='true']";
const BLOCK_NAMES = new Set(["p", "li", "blockquote", "figcaption", "td"]);
const SKIP_NAMES = new Set(["script", "style", "img", "object", "mjx-assistive-mml"]);
const ABBR = /(?:\b(?:e\.g|i\.e|et al|etc|vs|cf|Figs?|Eqs?|Secs?|Tab|Refs?|Algs?|approx|resp|No)|\b[A-Z])\.$/;
const SENTENCE_END = /[.!?]+["'\u2019\u201d)\]]*(?=\s+[A-Z0-9"'\u201c\u2018(\[\uFFFC])/g;
const OBJ = "\uFFFC";
const TONES = new Set(["pos", "neg", "neu", "accent"]);
const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function nameOf(node) {
  return String(node.localName || node.tagName || "").toLowerCase();
}

function isMath(node) {
  const name = nameOf(node);
  return name === "math" || name === "mjx-container";
}

function isDisplayMath(node) {
  const display = node.getAttribute("display");
  return display === "true" || display === "block";
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------- math */

// Math is hidden from the markdown converter behind placeholders. Only $$...$$
// and \(...\) count as math; a lone $ is literal text (currency-safe).
function protectMath(source) {
  const blocks = [];
  const hold = (tex) => {
    blocks.push(tex);
    return `\x00MATH${blocks.length - 1}\x00`;
  };
  let text = String(source == null ? "" : source).replace(/\$\$([\s\S]*?)\$\$/g, (_, math) =>
    hold(`\\[${math}\\]`),
  );
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => hold(`\\(${math}\\)`));
  return { text, blocks };
}

function restoreMath(html, blocks) {
  let out = html;
  blocks.forEach((tex, i) => {
    const escaped = tex.replace(/[&<>"']/g, (c) => HTML_ESC[c]);
    out = out.replace(`\x00MATH${i}\x00`, () => escaped);
  });
  return out;
}

/* ------------------------------------------------- reading mark: units */

function tokens(block) {
  const items = [];
  let run = [];
  const flush = () => {
    if (run.length) items.push({ run });
    run = [];
  };
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        run.push({ t: c });
      } else if (c.nodeType === 1) {
        const name = nameOf(c);
        if (isMath(c)) {
          if (isDisplayMath(c)) {
            flush();
            items.push({ disp: c });
          } else {
            run.push({ a: c });
          }
        } else if (SKIP_NAMES.has(name)) {
          // Not text: skipped.
        } else if (BLOCK_NAMES.has(name)) {
          // Nested block: it gets its own unit from attach(). Flattening it
          // here would let sentence ranges cross the block boundary.
        } else {
          walk(c);
        }
      }
    }
  };
  walk(block);
  flush();
  return items;
}

function sentences(run) {
  let s = "";
  const map = [];
  for (const p of run) {
    if (p.t) {
      const v = p.t.nodeValue;
      for (let i = 0; i < v.length; i++) map.push({ n: p.t, o: i, L: v.length });
      s += v;
    } else {
      map.push({ a: p.a });
      s += OBJ;
    }
  }
  const cuts = [0];
  const re = new RegExp(SENTENCE_END.source, "g");
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    if (!ABBR.test(s.slice(Math.max(0, end - 10), end))) cuts.push(end);
  }
  cuts.push(s.length);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    let a = cuts[i];
    let b = cuts[i + 1];
    while (a < b && /\s/.test(s[a])) a++;
    while (b > a && /\s/.test(s[b - 1])) b--;
    if (b > a) out.push([a, b]);
  }
  return { out, map };
}

function rangeFor(doc, block, map, a, b) {
  const r = doc.createRange();
  const f = map[a];
  const l = map[b - 1];
  if (f.a) r.setStartBefore(f.a);
  else if (f.o === 0) {
    let n = f.n;
    while (n.parentNode !== block && n === n.parentNode.firstChild) n = n.parentNode;
    r.setStartBefore(n);
  } else r.setStart(f.n, f.o);
  if (l.a) r.setEndAfter(l.a);
  else if (l.o === l.L - 1) {
    let n = l.n;
    while (n.parentNode !== block && n === n.parentNode.lastChild) n = n.parentNode;
    r.setEndAfter(n);
  } else r.setEnd(l.n, l.o + 1);
  return r;
}

function buildUnits(block, doc) {
  const out = [];
  for (const it of tokens(block)) {
    if (it.disp) {
      it.disp.classList.add("sr-unit");
      out.push(it.disp);
      continue;
    }
    const { out: ss, map } = sentences(it.run);
    const spans = [];
    for (let i = ss.length - 1; i >= 0; i--) {
      const r = rangeFor(doc, block, map, ss[i][0], ss[i][1]);
      const sp = doc.createElement("span");
      sp.className = "sr-unit";
      sp.appendChild(r.extractContents());
      r.insertNode(sp);
      spans.push(sp);
    }
    out.push(...spans.reverse());
  }
  return out;
}

/* ------------------------------------------------- reading mark: factory */

// Moveable highlighted unit (sentence or display equation). R toggles it,
// Up/Down or j/k move it, Esc or R stops it, a click on a unit starts it there.
//
// opts:
//   container      element whose units are read (required)
//   scroller       window (default) or the element that scrolls
//   unitSelector   block selector for units (default DEFAULT_UNIT_SELECTOR)
//   activeTarget   element that gets the `sr-active` class (default container)
//   hintParent     element that receives the key hint (default activeTarget)
//   keyTarget      where keydown is listened for (default the document)
//   onUnitChange   called with the unit each time the mark lands on one
//   topInset       px below the viewport top a unit must clear to be "first" (96)
//   window         window used for scrolling and geometry (defaults to the document's)
function createReadingMark(opts = {}) {
  const container = opts.container;
  if (!container) throw new TypeError("createReadingMark: opts.container is required");
  const doc = container.ownerDocument;
  const win = opts.window || doc.defaultView || globalThis;
  const scroller = opts.scroller || win;
  const blockSelector = opts.unitSelector || DEFAULT_UNIT_SELECTOR;
  const selector = `${blockSelector}, ${DISPLAY_MATH}`;
  const activeTarget = opts.activeTarget || container;
  const hintParent = opts.hintParent || activeTarget;
  const keyTarget = opts.keyTarget || doc;
  const onUnitChange = typeof opts.onUnitChange === "function" ? opts.onUnitChange : null;
  const topInset = typeof opts.topInset === "number" ? opts.topInset : 96;

  let units = [];
  let idx = -1;
  let on = false;
  let hintEl = null;
  let attached = false;

  function viewport() {
    if (scroller === win) return { top: 0, height: win.innerHeight };
    const r = scroller.getBoundingClientRect();
    return { top: r.top, height: scroller.clientHeight || r.height };
  }

  function scrollBy(top, behavior) {
    if (scroller === win) win.scrollBy({ top, behavior });
    else scroller.scrollBy({ top, behavior });
  }

  function hint() {
    if (!hintEl) {
      hintEl = doc.createElement("div");
      hintEl.className = "sr-hint";
      hintParent.appendChild(hintEl);
    }
    hintEl.textContent = on ? "\u2191 \u2193 move \u00b7 Esc exit" : "R: reading marker";
  }

  function inView(i) {
    const r = units[i].getBoundingClientRect();
    const vp = viewport();
    return r.bottom > vp.top && r.top < vp.top + vp.height;
  }

  function firstVisible() {
    const vp = viewport();
    for (let i = 0; i < units.length; i++) {
      if (units[i].getBoundingClientRect().top >= vp.top + topInset) return i;
    }
    return units.length - 1;
  }

  function ensure(u, fast) {
    const r = u.getBoundingClientRect();
    const vp = viewport();
    const top = r.top - vp.top;
    const bottom = r.bottom - vp.top;
    const h = vp.height;
    if (top < h * 0.22 || bottom > h * 0.82) scrollBy(top - h * 0.42, fast ? "auto" : "smooth");
  }

  function set(i, scrollIntoView, fast) {
    if (units[idx]) units[idx].classList.remove("sr-on");
    idx = Math.max(0, Math.min(units.length - 1, i));
    units[idx].classList.add("sr-on");
    if (scrollIntoView) ensure(units[idx], fast);
    if (onUnitChange) onUnitChange(units[idx]);
  }

  function activate(i) {
    if (!attached || !units.length) return;
    on = true;
    activeTarget.classList.add("sr-active");
    if (i !== undefined) set(i, false);
    else set(idx >= 0 && inView(idx) ? idx : firstVisible(), true);
    hint();
  }

  function deactivate() {
    on = false;
    activeTarget.classList.remove("sr-active");
    if (units[idx]) units[idx].classList.remove("sr-on");
    hint();
  }

  function onKeydown(e) {
    if (!units.length || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (on) deactivate();
      else activate();
      return;
    }
    if (!on) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      set(idx + 1, true, e.repeat);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      set(idx - 1, true, e.repeat);
    } else if (e.key === "Escape") {
      deactivate();
    }
  }

  function onClick(e) {
    const rootNode = container.getRootNode ? container.getRootNode() : doc;
    let sel = null;
    if (typeof rootNode.getSelection === "function") sel = rootNode.getSelection();
    else if (typeof doc.getSelection === "function") sel = doc.getSelection();
    if (sel && !sel.isCollapsed) return;
    const target = e.target;
    if (!units.length || !target || !target.closest) return;
    if (target.closest("a,button")) return;
    const u = target.closest(".sr-unit");
    if (!u) return;
    const i = units.indexOf(u);
    if (i < 0) return;
    if (on) set(i, false);
    else activate(i);
  }

  function detach() {
    if (attached) {
      keyTarget.removeEventListener("keydown", onKeydown);
      container.removeEventListener("click", onClick);
    }
    activeTarget.classList.remove("sr-active");
    if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
    hintEl = null;
    units = [];
    idx = -1;
    on = false;
    attached = false;
  }

  function attach() {
    if (attached) detach();
    for (const el of Array.from(container.querySelectorAll(selector))) {
      if (isMath(el)) {
        if (!el.parentElement.closest(blockSelector)) {
          el.classList.add("sr-unit");
          units.push(el);
        }
        continue;
      }
      // A block holding display math or a nested block unit is not a unit
      // itself; its children are picked up by their own matches.
      if (el.querySelector(DISPLAY_MATH)) continue;
      if (el.querySelector(blockSelector)) continue;
      units.push(...buildUnits(el, doc));
    }
    attached = true;
    hint();
    keyTarget.addEventListener("keydown", onKeydown);
    container.addEventListener("click", onClick);
  }

  return {
    get units() {
      return units;
    },
    get idx() {
      return idx;
    },
    get active() {
      return on;
    },
    attach,
    detach,
    activate,
    deactivate,
  };
}

/* ------------------------------------------------- document builder */

function badgeEl(doc, badge) {
  const tone = TONES.has(badge.tone) ? badge.tone : "neu";
  return el(doc, "span", `sr-badge sr-tone-${tone}`, badge.label == null ? "" : String(badge.label));
}

function unwrapParagraph(html) {
  const trimmed = html.trim();
  const m = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
  return m && !/<\/?p[\s>]/i.test(m[1]) ? m[1] : trimmed;
}

function requireSanitizer(ctx) {
  if (!ctx.sanitize) throw new Error("buildDocument: opts.sanitize is required for markdown and html blocks");
  return ctx.sanitize;
}

function markdownHtml(ctx, source) {
  if (!ctx.markdown) throw new Error("buildDocument: opts.markdown is required for markdown blocks");
  const sanitize = requireSanitizer(ctx);
  const { text, blocks } = protectMath(source);
  return sanitize(restoreMath(ctx.markdown(text), blocks), { svg: true });
}

function fragmentFromHtml(ctx, html) {
  const template = ctx.doc.createElement("template");
  template.innerHTML = html;
  const frag = template.content;
  resolveFigures(ctx, frag);
  return frag;
}

function mediaFor(ctx, figure, n) {
  if (figure.svg) return fragmentFromHtml(ctx, requireSanitizer(ctx)(figure.svg, { svg: true }));
  if (figure.url) {
    const img = ctx.doc.createElement("img");
    img.setAttribute("loading", "lazy");
    img.setAttribute("alt", `Figure ${n}`);
    img.setAttribute("src", figure.url);
    return img;
  }
  return null;
}

// Figures written in markdown as <figure data-n="N"> get their image or SVG
// from the figures list. Figures with neither are left alone for the page's
// own script to handle.
function resolveFigures(ctx, scope) {
  for (const fig of Array.from(scope.querySelectorAll("figure[data-n]"))) {
    if (fig.querySelector("img, svg")) continue;
    const n = fig.getAttribute("data-n");
    const figure = ctx.figureByN.get(n);
    if (!figure) continue;
    const media = mediaFor(ctx, figure, n);
    if (media) fig.insertBefore(media, fig.firstChild);
  }
}

function buildHeader(ctx, header) {
  const doc = ctx.doc;
  const wrap = el(doc, "header", "sr-header");
  if (header.kicker) {
    const kicker = el(doc, "p", "sr-kicker", header.kicker);
    if (header.kickerHref) {
      const link = el(doc, "a", "sr-kicker-link");
      link.setAttribute("href", header.kickerHref);
      link.appendChild(kicker);
      wrap.appendChild(link);
    } else {
      wrap.appendChild(kicker);
    }
  }
  wrap.appendChild(el(doc, "h1", "sr-title", header.title || ""));
  if (header.authors) wrap.appendChild(el(doc, "p", "sr-authors", header.authors));
  if (header.verdict) {
    const p = el(doc, "p", "sr-verdict");
    p.appendChild(el(doc, "b", null, "Verdict."));
    p.appendChild(doc.createTextNode(` ${header.verdict.text || ""}`));
    if (header.verdict.badge) {
      p.appendChild(doc.createTextNode(" "));
      p.appendChild(badgeEl(doc, header.verdict.badge));
    }
    wrap.appendChild(p);
  }
  return wrap;
}

function buildHeading(ctx, section) {
  const h2 = el(ctx.doc, "h2", "sr-h2");
  if (section.id) h2.id = section.id;
  h2.appendChild(ctx.doc.createTextNode(section.title));
  if (section.badge) h2.appendChild(badgeEl(ctx.doc, section.badge));
  return h2;
}

function fillCell(ctx, node, value) {
  if (value == null) return;
  if (typeof value === "object" && value.markdown != null) {
    node.appendChild(fragmentFromHtml(ctx, unwrapParagraph(markdownHtml(ctx, value.markdown))));
  } else if (typeof value === "object" && value.badge) {
    node.appendChild(badgeEl(ctx.doc, value.badge));
  } else {
    node.appendChild(ctx.doc.createTextNode(String(value)));
  }
}

function buildItems(ctx, items) {
  const frag = ctx.doc.createDocumentFragment();
  for (const item of items || []) {
    const row = el(ctx.doc, "div", "sr-item");
    if (item.badge) row.appendChild(badgeEl(ctx.doc, item.badge));
    if (item.markdown != null) {
      row.appendChild(fragmentFromHtml(ctx, unwrapParagraph(markdownHtml(ctx, item.markdown))));
    } else if (item.text != null) {
      row.appendChild(ctx.doc.createTextNode(String(item.text)));
    }
    frag.appendChild(row);
  }
  return frag;
}

function buildTable(ctx, block) {
  const doc = ctx.doc;
  const wrap = el(doc, "div", "sr-table-wrap");
  const table = el(doc, "table");
  if (block.head && block.head.length) {
    const thead = el(doc, "thead");
    const tr = el(doc, "tr");
    for (const h of block.head) {
      const th = el(doc, "th");
      fillCell(ctx, th, h);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  const tbody = el(doc, "tbody");
  for (const row of block.rows || []) {
    const tr = el(doc, "tr");
    for (const cell of row) {
      const td = el(doc, "td");
      fillCell(ctx, td, cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildFigure(ctx, block) {
  const n = String(block.n);
  const figure = ctx.figureByN.get(n);
  const fig = el(ctx.doc, "figure", "sr-figure");
  fig.setAttribute("data-n", n);
  if (figure && figure.dataA) fig.setAttribute("data-a", figure.dataA);
  const media = figure ? mediaFor(ctx, figure, n) : null;
  if (media) fig.appendChild(media);
  if (figure && figure.caption) fig.appendChild(el(ctx.doc, "figcaption", null, figure.caption));
  return fig;
}

function renderBlock(ctx, block) {
  switch (block.type) {
    case "markdown":
      return fragmentFromHtml(ctx, markdownHtml(ctx, block.text));
    case "items":
      return buildItems(ctx, block.items);
    case "table":
      return buildTable(ctx, block);
    case "html":
      return fragmentFromHtml(ctx, requireSanitizer(ctx)(block.html, { svg: true }));
    case "figure":
      return buildFigure(ctx, block);
    case "nodes":
      return block.nodes || [];
    default:
      throw new Error(`buildDocument: unknown block type "${block.type}"`);
  }
}

function headingText(h) {
  let s = "";
  for (const c of Array.from(h.childNodes)) {
    if (c.nodeType === 1 && c.classList && c.classList.contains("sr-badge")) continue;
    s += c.textContent || "";
  }
  return s.replace(/\s+/g, " ").trim();
}

// Table of contents markup: h2.sr-h2 and h3 headings in the article, with an
// id assigned to any heading that lacks one. Returns null below two entries.
function buildToc(doc, main) {
  let n = 0;
  const entries = [];
  for (const h of Array.from(main.querySelectorAll("h2.sr-h2, h3"))) {
    const text = headingText(h);
    if (!text) continue;
    if (!h.id) h.id = `sr-h-${n++}`;
    entries.push({ id: h.id, text, sub: (h.tagName || "").toUpperCase() === "H3" });
  }
  if (entries.length < 2) return null;
  const nav = el(doc, "nav", "sr-toc");
  nav.setAttribute("aria-label", "Table of contents");
  nav.appendChild(el(doc, "p", "sr-toc-title", "Contents"));
  const ul = el(doc, "ul");
  for (const entry of entries) {
    const li = el(doc, "li");
    const a = el(doc, "a", entry.sub ? "sr-toc-link sr-toc-sub" : "sr-toc-link", entry.text);
    a.setAttribute("href", `#${entry.id}`);
    li.appendChild(a);
    ul.appendChild(li);
  }
  nav.appendChild(ul);
  return nav;
}

// Markup only: no listeners, no layout reads. Call mountLayout() on the
// returned root once it is in a document.
//
// model:
//   header:   { kicker, kickerHref, title, authors, verdict: { text, badge } }
//   sections: [{ id, title, badge?, blocks: [...] }]
//   figures:  [{ n, dataA, caption, url, svg }]
// block types: markdown {text}, items {items:[{markdown|text, badge?}]},
//   table {head, rows}, html {html}, figure {n}, nodes {nodes}
//   Cells and items accept a plain string, {markdown} or {badge}.
// opts:
//   document   the document to build into (required)
//   markdown   (src) => html   converter for markdown blocks
//   sanitize   (html, {svg}) => html   required for markdown and html blocks
//
// Returns { root, page, main, toc, tocButton }. The ToC and its toggle button
// exist only when the article has two or more headings.
function buildDocument(model = {}, opts = {}) {
  const doc = opts.document;
  if (!doc) throw new TypeError("buildDocument: opts.document is required");
  const figures = Array.isArray(model.figures) ? model.figures : [];
  const ctx = {
    doc,
    markdown: typeof opts.markdown === "function" ? opts.markdown : null,
    sanitize: typeof opts.sanitize === "function" ? opts.sanitize : null,
    figureByN: new Map(),
  };
  figures.forEach((f, i) => ctx.figureByN.set(String(f.n != null ? f.n : i + 1), f));

  const root = el(doc, "div", "sr-root");
  const grid = el(doc, "div", "sr-grid");
  const page = el(doc, "div", "sr-page");
  const main = el(doc, "main", "sr-main");

  if (model.header) main.appendChild(buildHeader(ctx, model.header));
  for (const section of model.sections || []) {
    if (section.title) main.appendChild(buildHeading(ctx, section));
    for (const block of section.blocks || []) {
      const out = renderBlock(ctx, block);
      if (out.nodeType === 11 || Array.isArray(out)) {
        for (const node of Array.from(out.childNodes || out)) main.appendChild(node);
      } else {
        main.appendChild(out);
      }
    }
  }

  const toc = buildToc(doc, main);
  let tocButton = null;
  if (toc) {
    grid.appendChild(toc);
    tocButton = el(doc, "button", "sr-toc-btn", "Contents");
    tocButton.setAttribute("type", "button");
    page.appendChild(tocButton);
  }
  page.appendChild(main);
  grid.appendChild(page);
  root.appendChild(grid);
  return { root, page, main, toc, tocButton };
}

/* ------------------------------------------------- layout behaviour */

// Wires the table of contents: scroll-spy, the drawer for narrow widths and
// the Contents toggle. `scroller` is window (default) or the element that
// scrolls. Returns { dispose() }.
function mountLayout(root, opts = {}) {
  const doc = root.ownerDocument;
  const win = opts.window || doc.defaultView || globalThis;
  const scroller = opts.scroller || win;
  const page = root.querySelector(".sr-page");
  const toc = root.querySelector(".sr-toc");
  const button = root.querySelector(".sr-toc-btn");
  if (!page || !toc) return { dispose() {} };

  const headings = new Map();
  for (const h of Array.from(page.querySelectorAll("h2.sr-h2, h3"))) headings.set(h.id, h);
  const links = [];
  for (const a of Array.from(toc.querySelectorAll("a"))) {
    const target = headings.get((a.getAttribute("href") || "").slice(1));
    if (target) links.push({ a, target });
  }

  const isWindow = scroller === win;
  const metrics = () =>
    isWindow
      ? {
          top: 0,
          scrollTop: doc.documentElement.scrollTop,
          clientHeight: win.innerHeight,
          scrollHeight: doc.documentElement.scrollHeight,
        }
      : {
          top: scroller.getBoundingClientRect().top,
          scrollTop: scroller.scrollTop,
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
        };

  let active = null;
  let ticking = false;
  const update = () => {
    ticking = false;
    if (!links.length) return;
    const m = metrics();
    const line = m.top + 90;
    let cur = links[0];
    for (const item of links) {
      if (item.target.getBoundingClientRect().top <= line) cur = item;
      else break;
    }
    if (m.scrollTop + m.clientHeight >= m.scrollHeight - 4) cur = links[links.length - 1];
    if (cur === active) return;
    active = cur;
    for (const item of links) {
      item.a.classList.toggle("sr-toc-current", item === cur);
      if (item === cur) item.a.setAttribute("aria-current", "true");
      else item.a.removeAttribute("aria-current");
    }
    const l = cur.a;
    if (l.offsetTop < toc.scrollTop || l.offsetTop + l.offsetHeight > toc.scrollTop + toc.clientHeight) {
      toc.scrollTop = l.offsetTop - toc.clientHeight / 2;
    }
  };
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(update);
    else update();
  };

  // The ToC sits in the left column when the margin beside the centred column
  // fits it (14rem panel, 1rem offset, 1.5rem gap). Otherwise it is a drawer.
  const measure = () => {
    const style = win.getComputedStyle ? win.getComputedStyle(doc.documentElement) : null;
    const rem = (style && parseFloat(style.fontSize)) || 16;
    const scrollLeft = isWindow ? 0 : scroller.getBoundingClientRect().left;
    const room = page.getBoundingClientRect().left - scrollLeft;
    root.classList.toggle("sr-toc-wide", room >= 16.5 * rem);
  };
  let observer = null;
  if (typeof win.ResizeObserver === "function") {
    observer = new win.ResizeObserver(measure);
    observer.observe(root);
  } else {
    measure();
  }

  const onScroll = () => schedule();
  scroller.addEventListener("scroll", onScroll, { passive: true });
  schedule();

  // The panel floats over the margin, so wheel scrolling passes through to the article.
  const onWheel = (e) => {
    if (toc.scrollHeight > toc.clientHeight) return;
    if (isWindow) win.scrollBy(0, e.deltaY);
    else scroller.scrollBy({ top: e.deltaY });
  };
  toc.addEventListener("wheel", onWheel, { passive: true });

  const linkHandlers = links.map((item) => {
    const handler = (e) => {
      e.preventDefault();
      item.target.scrollIntoView({ block: "start", behavior: "smooth" });
      root.classList.remove("sr-toc-open");
    };
    item.a.addEventListener("click", handler);
    return [item.a, handler];
  });

  const onToggle = () => root.classList.toggle("sr-toc-open");
  if (button) button.addEventListener("click", onToggle);

  return {
    dispose() {
      scroller.removeEventListener("scroll", onScroll);
      toc.removeEventListener("wheel", onWheel);
      for (const [a, handler] of linkHandlers) a.removeEventListener("click", handler);
      if (button) button.removeEventListener("click", onToggle);
      if (observer) observer.disconnect();
    },
  };
}

/* ------------------------------------------------- fonts */

// @font-face rules are ignored inside shadow roots, so the stylesheet goes in
// the host document and the shadow tree names the families directly.
function ensureFonts(doc) {
  if (doc.getElementById("sr-fonts")) return;
  const pre = doc.createElement("link");
  pre.id = "sr-fonts-preconnect";
  pre.rel = "preconnect";
  pre.href = "https://fonts.googleapis.com";
  const link = doc.createElement("link");
  link.id = "sr-fonts";
  link.rel = "stylesheet";
  link.href = FONT_URL;
  doc.head.appendChild(pre);
  doc.head.appendChild(link);
}

function removeFonts(doc) {
  for (const id of ["sr-fonts", "sr-fonts-preconnect"]) {
    const node = doc.getElementById(id);
    if (node) node.parentNode.removeChild(node);
  }
}


  ScholarlyReader.CSS = CSS;
  ScholarlyReader.DEFAULT_UNIT_SELECTOR = DEFAULT_UNIT_SELECTOR;
  ScholarlyReader.FONT_URL = FONT_URL;
  ScholarlyReader.protectMath = protectMath;
  ScholarlyReader.restoreMath = restoreMath;
  ScholarlyReader.createReadingMark = createReadingMark;
  ScholarlyReader.buildDocument = buildDocument;
  ScholarlyReader.mountLayout = mountLayout;
  ScholarlyReader.ensureFonts = ensureFonts;
  ScholarlyReader.removeFonts = removeFonts;
  global.ScholarlyReader = ScholarlyReader;
})(typeof window !== "undefined" ? window : globalThis);
