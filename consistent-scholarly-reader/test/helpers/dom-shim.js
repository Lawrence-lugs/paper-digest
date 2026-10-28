// Consolidated minimal DOM shim shared by the issue #7, #9 and #10 test suites.
// Loads the CSR content-script IIFEs under plain Node (`node --test`).
// No layout, no network, no painting, no real timers, no external packages.
//
// Factories (all equivalent; aliases for the three importing styles):
//   createWindow() -> { window, document, getComputedStyle, Element, Node, Text,
//   ShadowRoot, Range, Event, KeyboardEvent, MouseEvent, Document, DocumentFragment }
//   makeWindowDocument()   (issue #7 imports this)
//   makeWindow()            (issue #10 imports this)
//
// `window` carries: innerWidth/innerHeight, document, URL, navigator.clipboard,
// getComputedStyle (controllable via .set/.clear/.clearAll), getSelection,
// requestAnimationFrame, ResizeObserver, MutationObserver,
// addEventListener/removeEventListener/dispatchEvent, Event/MouseEvent/KeyboardEvent/Range,
// __csr.scrollByLog (records scrollBy intent), and a scrollY getter/setter that
// tracks document.documentElement.scrollTop.

"use strict";

const URL = globalThis.URL;
const indexOf = (array, item) => {
  for (let i = 0; i < array.length; i++) if (array[i] === item) return i;
  return -1;
};

// ---------- controllable getComputedStyle stub ----------

function makeComputedStyle() {
  const overrides = new Map();
  const defaults = Object.create(null);
  defaults["font-size"] = "16px";
  defaults.width = "auto";
  defaults["max-width"] = "none";
  defaults["overflow-x"] = "";

  function gcs(el) {
    const ov = overrides.get(el) || Object.create(null);
    function get(p) {
      if (p in ov) return String(ov[p]);
      if (p in defaults) return defaults[p];
      return "";
    }
    return {
      getPropertyValue: get,
      get width() {
        return get("width");
      },
      get "max-width"() {
        return get("max-width");
      },
      get "font-size"() {
        return get("font-size");
      },
      get "overflow-x"() {
        return get("overflow-x");
      },
      toString() {
        return "";
      },
    };
  }
  gcs.set = (el, props) => {
    overrides.set(el, Object.assign(Object.create(null), props));
  };
  gcs.clear = (el) => {
    overrides.delete(el);
  };
  gcs.clearAll = () => {
    overrides.clear();
  };
  return gcs;
}

// ---------- event target ----------

class EventTarget {
  constructor() {
    this._listeners = {};
  }
  addEventListener(type, listener) {
    let list = this._listeners[type];
    if (!list) {
      list = [];
      this._listeners[type] = list;
    }
    if (!list.includes(listener)) list.push(listener);
  }
  removeEventListener(type, listener) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(listener);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) {
    // Preserve an explicitly-set target (e.g. new MouseEvent("click", {target})).
    event.target = event.target || this;
    event.currentTarget = this;
    if (event.defaultPrevented === undefined) event.defaultPrevented = false;
    let stop = false;
    event.stopPropagation = () => {
      stop = true;
    };
    let node = this;
    while (node) {
      event.currentTarget = node;
      const list = node._listeners && node._listeners[event.type];
      if (list) {
        for (const l of list) l.call(node, event);
        if (stop) return !event.defaultPrevented;
      }
      if (!event.bubbles) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
}

// ---------- nodes ----------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

class Node extends EventTarget {
  constructor(nodeType, ownerDocument) {
    super();
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this._children = [];
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  static get ELEMENT_NODE() {
    return ELEMENT_NODE;
  }
  static get TEXT_NODE() {
    return TEXT_NODE;
  }
  static get DOCUMENT_NODE() {
    return DOCUMENT_NODE;
  }
  static get DOCUMENT_FRAGMENT_NODE() {
    return DOCUMENT_FRAGMENT_NODE;
  }
  get childNodes() {
    return this._children;
  }
  get firstChild() {
    return this._children[0] || null;
  }
  get lastChild() {
    return this._children[this._children.length - 1] || null;
  }
  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = indexOf(p._children, this);
    return i >= 0 ? p._children[i + 1] || null : null;
  }
  get parentElement() {
    let n = this.parentNode;
    while (n && n.nodeType !== ELEMENT_NODE) n = n.parentNode;
    return n || null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === DOCUMENT_NODE;
  }
  get children() {
    return this._children.filter((n) => n.nodeType === ELEMENT_NODE);
  }
  appendChild(node) {
    if (!(node instanceof Node)) {
      throw new Error("Node.appendChild: not a Node");
    }
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      while (node._children.length) this.appendChild(node._children[0]);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this._children.push(node);
    return node;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
    return this;
  }
  insertBefore(node, ref) {
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      while (node._children.length) this.insertBefore(node._children[0], ref);
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    let i = ref ? indexOf(this._children, ref) : this._children.length;
    if (i < 0) i = this._children.length;
    this._children.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    node.remove();
    return node;
  }
  remove() {
    const parent = this.parentNode;
    if (parent) {
      const i = parent._children.indexOf(this);
      if (i >= 0) parent._children.splice(i, 1);
      this.parentNode = null;
    }
  }
  replaceWith(node) {
    const parent = this.parentNode;
    if (!parent) return;
    const i = parent._children.indexOf(this);
    if (i < 0) return;
    if (node.nodeType === DOCUMENT_FRAGMENT_NODE) {
      while (node._children.length) parent.insertBefore(node._children[0], this);
    } else {
      parent.insertBefore(node, this);
    }
    parent.removeChild(this);
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  get textContent() {
    let s = "";
    for (const c of this._children) s += c.textContent || "";
    return s;
  }
  set textContent(v) {
    while (this._children.length) this._children[0].remove();
    if (v != null && v !== "") this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  cloneNode(deep = false) {
    const copy = new Element(this.ownerDocument, this.tagName || "div");
    const attrs = this.attributes || [];
    for (const a of attrs) copy.setAttribute(a.name, a.value);
    if (deep) {
      for (const ch of this._children) {
        const ccopy = ch.nodeType === Node.TEXT_NODE
          ? new Text(this.ownerDocument, ch.data)
          : ch.cloneNode(true);
        copy.appendChild(ccopy);
      }
    }
    return copy;
  }
  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    };
  }
  scrollBy(options) {
    const top = options && options.top !== undefined ? Number(options.top) : 0;
    const behavior = (options && options.behavior) || "auto";
    const win = this.ownerDocument && this.ownerDocument.defaultView;
    if (win && win.__csr) win.__csr.scrollByLog.push({ top, behavior });
    this.scrollTop += top;
  }
  focus() {}
  blur() {}
  click() {}
}

class Text extends Node {
  constructor(ownerDocument, data = "") {
    super(TEXT_NODE, ownerDocument);
    this.nodeName = "#text";
    this.nodeValue = String(data);
    this.data = this.nodeValue;
  }
  get textContent() {
    return this.nodeValue;
  }
  set textContent(v) {
    this.nodeValue = String(v);
    this.data = this.nodeValue;
  }
}

function createStyle(el) {
  const props = {};
  const serialize = () =>
    Object.keys(props)
      .map((k) => k + ":" + String(props[k]))
      .join(";");
  return new Proxy(
    {},
    {
      get(target, key) {
        if (key === "cssText") return serialize();
        return key in target ? target[key] : props[key];
      },
      set(target, key, value) {
        if (key === "cssText") {
          for (const decl of String(value).split(";").filter(Boolean)) {
            const eq = decl.indexOf(":");
            if (eq === -1) continue;
            props[decl.slice(0, eq).trim()] = decl.slice(eq + 1).trim();
          }
        } else {
          props[key] = String(value);
        }
        el.setAttribute("style", serialize());
        return true;
      },
    }
  );
}

class Element extends Node {
  constructor(ownerDocument, tagName) {
    super(ELEMENT_NODE, ownerDocument);
    this.tagName = String(tagName || "div").toUpperCase();
    this.nodeName = this.tagName;
    this.namespaceURI = null;
    this._attrList = [];
    this.id = "";
    this.innerHTML = "";
    this._classes = new Set();
    this.style = createStyle(this);
  }
  get attributes() {
    return this._attrList;
  }
  set attributes(v) {
    this._attrList = v;
  }
  get className() {
    return [...this._classes].join(" ");
  }
  set className(v) {
    this._classes.clear();
    String(v || "").split(/\s+/).forEach((c) => { if (c) this._classes.add(c); });
  }
  get classList() {
    const self = this;
    return {
      add: (...names) => {
        for (const n of names) if (n) self._classes.add(n);
      },
      remove: (...names) => {
        for (const n of names) self._classes.delete(n);
      },
      contains: (n) => self._classes.has(n),
      toggle: (n, force) => {
        const current = self._classes.has(n);
        if (force === undefined) force = !current;
        if (force) self._classes.add(n); else self._classes.delete(n);
        return force;
      },
    };
  }
  get id() {
    const a = this._attr("id");
    return a ? a.value : "";
  }
  set id(v) {
    v = String(v);
    const existing = this._attr("id");
    if (existing) existing.value = v;
    else this._attrList.push({ name: "id", value: v });
  }
  _attr(name) {
    return this._attrList.find((a) => a.name === name);
  }
  getAttribute(name) {
    const a = this._attr(name);
    return a ? a.value : null;
  }
  setAttribute(name, value) {
    value = String(value);
    const existing = this._attr(name);
    if (existing) existing.value = value;
    else this._attrList.push({ name, value });
    if (name === "class") {
      this._classes.clear();
      value.split(/\s+/).forEach((c) => { if (c) this._classes.add(c); });
    }
  }
  hasAttribute(name) {
    return this._attr(name) !== undefined;
  }
  removeAttribute(name) {
    this._attrList = this._attrList.filter((a) => a.name !== name);
    if (name === "id") this.id = "";
    if (name === "class") {
      this._classes.clear();
    }
  }
  get ownerDocument() {
    return this._ownerDocument;
  }
  set ownerDocument(v) {
    this._ownerDocument = v;
  }
  matches(selector) {
    return compileSelector(selector).some((parts) => matchesCompound(this, parts));
  }
  attachShadow({ mode } = {}) {
    if (this._shadowRoot) return this._shadowRoot;
    const sr = new ShadowRoot(this, mode || "open", this.ownerDocument);
    this._shadowRoot = sr;
    return sr;
  }
  get shadowRoot() {
    return this._shadowRoot || null;
  }
  closest(selector) {
    const compounds = compileSelector(selector);
    let node = this;
    while (node && node.nodeType === ELEMENT_NODE) {
      for (const parts of compounds) {
        if (matchesCompound(node, parts)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
  querySelector(selector) {
    const r = this.querySelectorAll(selector);
    return r[0] || null;
  }
  querySelectorAll(selector) {
    // element.querySelectorAll matches descendants only, never the element itself.
    const compounds = compileSelector(selector);
    const out = [];
    const walk = (node) => {
      for (const child of node._children) {
        if (child.nodeType === ELEMENT_NODE) {
          if (compounds.some((c) => matchesCompound(child, c))) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }
  get innerHTML() {
    return this._innerHTML || "";
  }
  set innerHTML(html) {
    this._innerHTML = String(html);
    parseInnerHTML(this, String(html));
  }
}

class DocumentFragment extends Node {
  constructor(ownerDocument) {
    super(DOCUMENT_FRAGMENT_NODE, ownerDocument);
  }
  get textContent() {
    let out = "";
    for (const child of this._children) out += child.textContent || "";
    return out;
  }
  set textContent(value) {
    while (this._children.length) this._children[0].remove();
    if (value != null && value !== "") this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  querySelectorAll(selector) {
    return querySelectorAllIn(this, selector);
  }
  querySelector(selector) {
    const r = this.querySelectorAll(selector);
    return r[0] || null;
  }
}

class ShadowRoot extends Node {
  constructor(host, mode, ownerDocument) {
    super(DOCUMENT_FRAGMENT_NODE, ownerDocument);
    this.nodeName = "#shadow-root";
    this.host = host;
    this.mode = mode;
  }
  getAttribute() {
    return null;
  }
  setAttribute() {}
  hasAttribute() {
    return false;
  }
  removeAttribute() {}
  getElementById(id) {
    return findById(this, id);
  }
  querySelector(selector) {
    const r = this.querySelectorAll(selector);
    return r[0] || null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      if (node.nodeType === ELEMENT_NODE) {
        const compounds = compileSelector(selector);
        if (compounds.some((c) => matchesCompound(node, c))) out.push(node);
        for (const child of node._children) walk(child);
      } else {
        for (const child of node._children) walk(child);
      }
    };
    walk(this);
    return out;
  }
  matches(selector) {
    return compileSelector(selector).some((parts) => matchesCompound(this, parts));
  }
  closest(selector) {
    const compounds = compileSelector(selector);
    let node = this;
    while (node && node.nodeType === ELEMENT_NODE) {
      for (const parts of compounds) {
        if (matchesCompound(node, parts)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
  getSelection() {
    return null;
  }
}

class Document extends Node {
  constructor() {
    super(DOCUMENT_NODE, null);
    this.baseURI = "http://localhost/";
    this.defaultView = null; // filled in createWindow
    this.documentElement = new Element(this, "html");
    this.documentElement.parentNode = this;
    this._children = [this.documentElement];
    this.head = new Element(this, "head");
    this.body = new Element(this, "body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.location = { href: this.baseURI };
  }
  createElement(tag) {
    const el = new Element(this, tag);
    el.ownerDocument = this;
    return el;
  }
  createTextNode(data) {
    return new Text(this, data);
  }
  createDocumentFragment() {
    return new DocumentFragment(this);
  }
  createRange() {
    return new Range(this);
  }
  getElementById(id) {
    return findById(this.documentElement, id);
  }
  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
  execCommand() {
    return false;
  }
}

// ---------- range (enough for readingMark sentence extraction) ----------

class Range {
  constructor(ownerDocument) {
    this.startContainer = null;
    this.startOffset = 0;
    this.endContainer = null;
    this.endOffset = 0;
    this.collapsed = true;
    this.ownerDocument = ownerDocument;
  }
  setStartBefore(node) {
    this.startContainer = node.parentNode;
    this.startOffset = indexOf(node.parentNode._children, node);
  }
  setEndAfter(node) {
    this.endContainer = node.parentNode;
    this.endOffset = indexOf(node.parentNode._children, node) + 1;
  }
  setStart(node, offset) {
    this.startContainer = node;
    this.startOffset = Number(offset);
  }
  setEnd(node, offset) {
    this.endContainer = node;
    this.endOffset = Number(offset);
  }
  extractContents() {
    const frag = this.ownerDocument.createDocumentFragment();
    const sc = this.startContainer;
    const ec = this.endContainer;
    const so = this.startOffset;
    const eo = this.endOffset;
    if (sc && sc.nodeType === TEXT_NODE && sc === ec && so < eo) {
      const val = sc.nodeValue;
      const removed = val.slice(so, eo);
      sc.nodeValue = val.slice(0, so) + val.slice(eo);
      frag.appendChild(this.ownerDocument.createTextNode(removed));
      return frag;
    }
    if (sc && ec && sc === ec && sc.nodeType === ELEMENT_NODE) {
      const kids = sc._children.slice(so, eo);
      for (const child of kids) {
        sc.removeChild(child);
        frag.appendChild(child);
      }
      return frag;
    }
    return frag;
  }
  insertNode(node) {
    const sc = this.startContainer;
    if (sc && sc.nodeType === TEXT_NODE) {
      const parent = sc.parentNode;
      const val = sc.nodeValue;
      const before = val.slice(0, this.startOffset);
      const after = val.slice(this.startOffset);
      sc.nodeValue = before;
      if (after) {
        const rest = sc.ownerDocument.createTextNode(after);
        parent.insertBefore(rest, sc.nextSibling);
      }
      parent.insertBefore(node, rest || sc);
      return node;
    }
    if (sc && sc.nodeType === ELEMENT_NODE) {
      sc.insertBefore(node, sc._children[this.startOffset] || null);
      return node;
    }
    return node;
  }
  getBoundingClientRect() {
    return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }
  get commonAncestorContainer() {
    return this.startContainer || this.endContainer || null;
  }
}

// ---------- events ----------

class Event {
  constructor(type, opts = {}) {
    this.type = String(type);
    this.target = opts.target || null;
    this.currentTarget = null;
    this.bubbles = !!opts.bubbles;
    this.cancelable = !!opts.cancelable;
    this.defaultPrevented = false;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() {}
  composedPath() {
    const path = [];
    let node = this.target;
    while (node) {
      path.push(node);
      node = node.parentNode;
    }
    return path;
  }
}

class MouseEvent extends Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.clientX = opts.clientX || 0;
    this.clientY = opts.clientY || 0;
    this.button = opts.button || 0;
    this.buttons = opts.buttons || 0;
  }
}

class KeyboardEvent extends Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.key = opts.key || "";
    this.code = opts.code || "";
    this.ctrlKey = !!opts.ctrlKey;
    this.shiftKey = !!opts.shiftKey;
    this.altKey = !!opts.altKey;
    this.metaKey = !!opts.metaKey;
    this.repeat = !!opts.repeat;
  }
}

// ---------- css selector engine (tag, .class, #id, [attr], [attr=val],
//            descendant combinator via whitespace, comma groups) ----------

function stripQuotes(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parseSimple(sel) {
  const simple = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  let m;
  while (i < sel.length) {
    if (i === 0 && (m = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(sel))) {
      simple.tag = m[0].toLowerCase();
      i += m[0].length;
      continue;
    }
    if ((m = /^#([\w-]+)/.exec(sel.slice(i)))) {
      simple.id = m[1];
      i += m[0].length;
      continue;
    }
    if ((m = /^\.([\w-]+)/.exec(sel.slice(i)))) {
      simple.classes.push(m[1]);
      i += m[0].length;
      continue;
    }
    if ((m = /^\[([^\]]*)\]/.exec(sel.slice(i)))) {
      const inner = m[1];
      const eq = inner.indexOf("=");
      if (eq === -1) {
        simple.attrs.push({ name: inner, op: "exists" });
      } else {
        simple.attrs.push({ name: inner.slice(0, eq), op: "=", val: stripQuotes(inner.slice(eq + 1)) });
      }
      i += m[0].length;
      continue;
    }
    break;
  }
  return simple;
}

function compileCompound(compound) {
  return compound.split(/\s+/).filter(Boolean).map(parseSimple);
}

function compileSelector(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(compileCompound);
}

function matchesSimple(el, simple) {
  if (simple.tag && (el.tagName || "").toLowerCase() !== simple.tag) return false;
  if (simple.id != null && el.getAttribute("id") !== simple.id) return false;
  for (const c of simple.classes) if (!el.classList.contains(c)) return false;
  for (const a of simple.attrs) {
    if (a.op === "exists") {
      if (!el.hasAttribute(a.name)) return false;
    } else if (el.getAttribute(a.name) !== a.val) {
      return false;
    }
  }
  return true;
}

function matchesCompound(el, parts) {
  // The rightmost (last) simple selector must match the element itself;
  // preceding parts are matched against ancestors (descendant combinator).
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let node = el.parentElement;
  while (node && node.nodeType === ELEMENT_NODE && i >= 0) {
    if (matchesSimple(node, parts[i])) i--;
    if (i < 0) return true;
    node = node.parentElement;
  }
  return i < 0;
}

function querySelectorAllIn(root, selector) {
  const out = [];
  const compounds = compileSelector(selector);
  const walk = (node) => {
    for (const child of node._children || []) {
      if (child.nodeType === ELEMENT_NODE) {
        if (compounds.some((c) => matchesCompound(child, c))) out.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function findById(root, id) {
  if (root.nodeType === ELEMENT_NODE && root.getAttribute("id") === id) return root;
  for (const c of root._children) {
    const found = findById(c, id);
    if (found) return found;
  }
  return null;
}

const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'|([\w:-]+)/g;

function parseAttrs(html, el) {
  attrRe.lastIndex = 0;
  let m;
  while ((m = attrRe.exec(html))) {
    if (m[1] !== undefined) el.setAttribute(m[1], m[2]);
    else if (m[3] !== undefined) el.setAttribute(m[3], m[4]);
    else el.setAttribute(m[5], "");
  }
}

function parseInnerHTML(el, html) {
  while (el.firstChild) el.removeChild(el.firstChild);
  el._innerHTML = html;
  const stack = [el];
  let current = el;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (i < html.length) current.appendChild(el.ownerDocument.createTextNode(html.slice(i)));
      break;
    }
    if (lt > i) current.appendChild(el.ownerDocument.createTextNode(html.slice(i, lt)));
    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      current.appendChild(el.ownerDocument.createTextNode(html.slice(lt)));
      break;
    }
    const inner = html.slice(lt + 1, gt);
    if (inner[0] === "/") {
      stack.pop();
      current = stack[stack.length - 1] || el;
    } else {
      const m = /^([a-zA-Z][a-zA-Z0-9-]*)\s*([\s\S]*)$/.exec(inner);
      if (m) {
        const node = el.ownerDocument.createElement(m[1]);
        parseAttrs(m[2], node);
        current.appendChild(node);
        if (!/\/\s*$/.test(m[2])) {
          stack.push(node);
          current = node;
        }
      } else {
        current.appendChild(el.ownerDocument.createTextNode(inner));
      }
    }
    i = gt + 1;
  }
}

// ---------- window factory ----------

function createWindow() {
  const document = new Document();
  const gcs = makeComputedStyle();

  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    document,
    defaultView: null, // filled below
    __csr: { scrollByLog: [] },
    navigator: {
      userAgent: "csr-dom-shim/1.0 (test)",
      platform: "test",
      clipboard: {
        writeText: async () => {},
      },
    },
    URL,
    getComputedStyle: gcs,
    getSelection: () => ({ isCollapsed: true }),
    requestAnimationFrame: (fn) => {
      fn();
      return 0;
    },
    setTimeout: () => {},
    clearTimeout: () => {},
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    Event,
    MouseEvent,
    KeyboardEvent,
    Range,
  };
  window.defaultView = window;

  Object.defineProperty(window, "scrollY", {
    get() {
      return document.documentElement.scrollTop;
    },
    set(v) {
      document.documentElement.scrollTop = Number(v) || 0;
    },
    configurable: true,
  });

  return {
    window,
    document,
    getComputedStyle: gcs,
    ResizeObserver: window.ResizeObserver,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    Element,
    Node,
    Text,
    ShadowRoot,
    Range,
    Event,
    KeyboardEvent,
    MouseEvent,
    Document,
    DocumentFragment,
  };
}

module.exports = {
  createWindow,
  makeWindow: createWindow,
  makeWindowDocument: createWindow,
  Event,
  KeyboardEvent,
  MouseEvent,
  Range,
  Node,
  Text,
  ShadowRoot,
  Element,
  Document,
  DocumentFragment,
  ELEMENT_NODE,
  TEXT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_FRAGMENT_NODE,
};
