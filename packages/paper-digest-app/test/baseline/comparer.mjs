/**
 * Baseline HTML comparer for paper-digest.
 *
 * Normalizes HTML by:
 * - Sorting attributes alphabetically within each tag
 * - Collapsing whitespace sequences to single spaces (except in <pre>, <code>, <script>, <style>)
 * - Removing leading/trailing whitespace from text nodes
 * - Normalizing self-closing tags
 * - Removing comments
 *
 * Then performs a character-by-character diff to find the first difference.
 */

import { JSDOM } from "jsdom";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

const PRESERVE_WHITESPACE_TAGS = new Set(["pre", "code", "script", "style", "textarea"]);

/**
 * Normalize a single attribute value - unescape entities for comparison
 */
function normalizeAttrValue(value) {
  return String(value)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Serialize attributes in sorted order
 */
function serializeAttributes(attrs) {
  const sorted = Array.from(attrs).sort((a, b) => a.name.localeCompare(b.name));
  return sorted.map(attr => {
    const value = normalizeAttrValue(attr.value);
    // Quote attribute values consistently
    if (value.includes('"') && !value.includes("'")) {
      return `${attr.name}='${value}'`;
    }
    return `${attr.name}="${value}"`;
  }).join(" ");
}

/**
 * Check if we're inside a whitespace-preserving element
 */
function inPreserveWhitespaceElement(node) {
  while (node) {
    if (PRESERVE_WHITESPACE_TAGS.has(node.nodeName.toLowerCase())) {
      return true;
    }
    node = node.parentNode;
  }
  return false;
}

/**
 * Normalize text content - collapse whitespace unless in preserve element
 */
function normalizeText(text, preserveWhitespace) {
  if (preserveWhitespace) {
    return text;
  }
  // Replace all whitespace sequences with single space, trim
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Recursively normalize a DOM node
 */
function normalizeNode(node) {
  const preserve = inPreserveWhitespaceElement(node);

  if (node.nodeType === node.TEXT_NODE) {
    return normalizeText(node.textContent, preserve);
  }

  if (node.nodeType === node.COMMENT_NODE) {
    return ""; // Strip comments
  }

  if (node.nodeType === node.ELEMENT_NODE) {
    const tagName = node.nodeName.toLowerCase();
    const attrs = serializeAttributes(node.attributes);

    // Process children
    let childrenHtml = "";
    for (const child of node.childNodes) {
      childrenHtml += normalizeNode(child);
    }

    // For void elements, no closing tag
    if (VOID_ELEMENTS.has(tagName)) {
      return `<${tagName}${attrs ? " " + attrs : ""}>`;
    }

    return `<${tagName}${attrs ? " " + attrs : ""}>${childrenHtml}</${tagName}>`;
  }

  return "";
}

/**
 * Normalize HTML string for comparison
 */
export function normalizeHtml(html) {
  const dom = new JSDOM(html, {
    contentType: "text/html",
    includeNodeLocations: false,
  });

  let result = "";
  for (const child of dom.window.document.documentElement.childNodes) {
    result += normalizeNode(child);
  }

  // Normalize doctype
  if (html.trim().startsWith("<!DOCTYPE")) {
    result = "<!DOCTYPE html>" + result;
  }

  return result;
}

/**
 * Find first difference between two strings, return context
 */
export function findDiff(actual, expected) {
  if (actual === expected) {
    return null;
  }

  const minLen = Math.min(actual.length, expected.length);
  let firstDiff = -1;

  for (let i = 0; i < minLen; i++) {
    if (actual[i] !== expected[i]) {
      firstDiff = i;
      break;
    }
  }

  if (firstDiff === -1) {
    // One string is a prefix of the other
    firstDiff = minLen;
  }

  // Return context around the difference
  const contextRadius = 50;
  const start = Math.max(0, firstDiff - contextRadius);
  const endActual = Math.min(actual.length, firstDiff + contextRadius);
  const endExpected = Math.min(expected.length, firstDiff + contextRadius);

  return {
    position: firstDiff,
    actual: {
      before: actual.slice(start, firstDiff),
      at: actual.slice(firstDiff, endActual),
      after: actual.slice(endActual, endActual + contextRadius),
    },
    expected: {
      before: expected.slice(start, firstDiff),
      at: expected.slice(firstDiff, endExpected),
      after: expected.slice(endExpected, endExpected + contextRadius),
    },
  };
}

/**
 * Compare two HTML strings, returning normalized diff or null if equal
 */
export function compareHtml(actualHtml, expectedHtml) {
  const normalizedActual = normalizeHtml(actualHtml);
  const normalizedExpected = normalizeHtml(expectedHtml);

  if (normalizedActual === normalizedExpected) {
    return { equal: true, normalizedActual, normalizedExpected };
  }

  const diff = findDiff(normalizedActual, normalizedExpected);
  return {
    equal: false,
    diff,
    normalizedActual,
    normalizedExpected,
  };
}

/**
 * Assert that two HTML strings are equal after normalization
 */
export function assertHtmlEqual(actualHtml, expectedHtml, message = "HTML mismatch") {
  const result = compareHtml(actualHtml, expectedHtml);
  if (!result.equal) {
    const { diff, normalizedActual, normalizedExpected } = result;
    const err = new Error(`${message}\n\nFirst difference at position ${diff.position}:\n\nActual:   ...${diff.actual.before}▶${diff.actual.at}...${diff.actual.after}\nExpected: ...${diff.expected.before}▶${diff.expected.at}...${diff.expected.after}\n\nFull normalized actual length: ${normalizedActual.length}\nFull normalized expected length: ${normalizedExpected.length}`);
    err.actual = normalizedActual;
    err.expected = normalizedExpected;
    err.diff = diff;
    throw err;
  }
  return true;
}

export default {
  normalizeHtml,
  findDiff,
  compareHtml,
  assertHtmlEqual,
};