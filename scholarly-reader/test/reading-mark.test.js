/**
 * Unit tests for createReadingMark factory.
 * Run with: node --test test/reading-mark.test.js
 */

import { JSDOM } from "jsdom";
import { strict as assert } from "node:assert";
import { test, describe, beforeEach, afterEach } from "node:test";
import { createReadingMark, DEFAULT_UNIT_SELECTOR } from "../src/scholarly-reader.js";

function createDOM(html = "<!doctype html><html><body></body></html>") {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
  return dom.window;
}

describe("createReadingMark", () => {
  let window, document, container;

  beforeEach(() => {
    window = createDOM(`
      <!doctype html>
      <html>
      <body>
        <div id="container">
          <p>First paragraph. Second sentence here.</p>
          <p>Third paragraph with more text. And another sentence.</p>
          <li>List item one.</li>
          <li>List item two.</li>
          <blockquote>A quote. With two sentences.</blockquote>
          <figcaption>Figure caption. Another sentence.</figcaption>
          <table><tr><td>Cell one.</td><td>Cell two.</td></tr></table>
        </div>
      </body>
      </html>
    `);
    document = window.document;
    container = document.getElementById("container");
  });

  describe("container selection", () => {
    test("throws when container is not provided", () => {
      assert.throws(() => createReadingMark({}), /opts\.container is required/);
    });

    test("accepts a valid container element", () => {
      const mark = createReadingMark({ container });
      assert.ok(mark);
      assert.equal(typeof mark.attach, "function");
      assert.equal(typeof mark.detach, "function");
      assert.equal(typeof mark.activate, "function");
      assert.equal(typeof mark.deactivate, "function");
    });
  });

  describe("window scroller vs element scroller", () => {
    test("defaults to window scroller", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      // Should not throw
      mark.detach();
    });

    test("accepts custom element scroller", () => {
      const scroller = document.createElement("div");
      scroller.style.overflow = "auto";
      scroller.style.height = "100px";
      document.body.appendChild(scroller);
      scroller.appendChild(container);

      const mark = createReadingMark({ container, scroller });
      mark.attach();
      mark.detach();
    });
  });

  describe("unitSelector option", () => {
    test("uses DEFAULT_UNIT_SELECTOR by default", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      // Should find p, li, blockquote, figcaption, td
      assert.ok(mark.units.length > 0);
      mark.detach();
    });

    test("accepts custom unitSelector", () => {
      const mark = createReadingMark({ container, unitSelector: "p" });
      mark.attach();
      // Should only find units within p elements (sentences become span.sr-unit)
      for (const unit of mark.units) {
        // Units are span.sr-unit for sentences, or the element itself for display math
        assert.ok(unit.classList.contains("sr-unit"));
      }
      mark.detach();
    });
  });

  describe("onUnitChange callback", () => {
    test("fires on index change when activate is called", () => {
      let callCount = 0;
      let lastUnit = null;
      const mark = createReadingMark({
        container,
        onUnitChange: (unit) => { callCount++; lastUnit = unit; }
      });
      mark.attach();
      mark.activate(0);
      assert.equal(callCount, 1);
      assert.ok(lastUnit);
      mark.activate(1);
      assert.equal(callCount, 2);
      mark.detach();
    });

    test("fires when moving with set (via keyboard simulation)", () => {
      let calls = [];
      const mark = createReadingMark({
        container,
        onUnitChange: (unit) => calls.push(mark.idx)
      });
      mark.attach();
      mark.activate(0);
      mark.activate(1);
      // Callback should have fired twice (once for index 0, once for index 1)
      assert.equal(calls.length, 2);
      assert.equal(calls[0], 0);
      assert.equal(calls[1], 1);
      mark.detach();
    });

    test("does not fire when callback is not a function", () => {
      const mark = createReadingMark({ container, onUnitChange: "not a function" });
      mark.attach();
      mark.activate(0);
      // Should not throw
      mark.detach();
    });
  });

  describe("attach and detach idempotency", () => {
    test("attach is idempotent (calling twice detaches first)", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      const firstUnits = mark.units.length;
      mark.attach();
      const secondUnits = mark.units.length;
      assert.equal(firstUnits, secondUnits);
      mark.detach();
    });

    test("detach clears all state", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.activate(0);
      assert.equal(mark.active, true);
      assert.equal(mark.idx, 0);
      mark.detach();
      assert.equal(mark.active, false);
      assert.equal(mark.idx, -1);
      assert.equal(mark.units.length, 0);
    });

    test("detach is idempotent", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.detach();
      mark.detach(); // Should not throw
      assert.equal(mark.units.length, 0);
    });
  });

  describe("activate and deactivate", () => {
    test("activate turns on the mark", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      assert.equal(mark.active, false);
      mark.activate();
      assert.equal(mark.active, true);
      mark.detach();
    });

    test("activate with index sets position", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.activate(2);
      assert.equal(mark.idx, 2);
      assert.ok(mark.units[2].classList.contains("sr-on"));
      mark.detach();
    });

    test("deactivate turns off the mark", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.activate(0);
      assert.equal(mark.active, true);
      mark.deactivate();
      assert.equal(mark.active, false);
      // idx is preserved after deactivate (only active flag changes)
      assert.equal(mark.idx, 0);
      // But the sr-on class is removed
      assert.ok(!mark.units[0].classList.contains("sr-on"));
      mark.detach();
    });

    test("activate/deactivate are idempotent", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.activate();
      mark.activate(); // Should not throw
      mark.deactivate();
      mark.deactivate(); // Should not throw
      mark.detach();
    });
  });

  describe("hint element", () => {
    test("creates hint element on attach", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      const hint = container.querySelector(".sr-hint");
      assert.ok(hint);
      assert.equal(hint.textContent, "R: reading marker");
      mark.detach();
    });

    test("removes hint element on detach", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      mark.detach();
      const hint = container.querySelector(".sr-hint");
      assert.equal(hint, null);
    });

    test("updates hint text on activate/deactivate", () => {
      const mark = createReadingMark({ container });
      mark.attach();
      let hint = container.querySelector(".sr-hint");
      assert.equal(hint.textContent, "R: reading marker");
      mark.activate();
      hint = container.querySelector(".sr-hint");
      assert.equal(hint.textContent, "↑ ↓ move · Esc exit");
      mark.deactivate();
      hint = container.querySelector(".sr-hint");
      assert.equal(hint.textContent, "R: reading marker");
      mark.detach();
    });
  });

  describe("activeTarget option", () => {
    test("adds sr-active class to activeTarget on activate", () => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      const mark = createReadingMark({ container, activeTarget: target });
      mark.attach();
      mark.activate();
      assert.ok(target.classList.contains("sr-active"));
      mark.deactivate();
      assert.ok(!target.classList.contains("sr-active"));
      mark.detach();
    });
  });

  describe("hintParent option", () => {
    test("appends hint to hintParent", () => {
      const hintParent = document.createElement("div");
      document.body.appendChild(hintParent);
      const mark = createReadingMark({ container, hintParent });
      mark.attach();
      const hint = hintParent.querySelector(".sr-hint");
      assert.ok(hint);
      mark.detach();
    });
  });

  describe("keyTarget option", () => {
    test("listens for keydown on keyTarget", () => {
      const keyTarget = document.createElement("div");
      document.body.appendChild(keyTarget);
      const mark = createReadingMark({ container, keyTarget });
      mark.attach();
      // Simulate keydown on keyTarget
      const event = new window.KeyboardEvent("keydown", { key: "r" });
      keyTarget.dispatchEvent(event);
      // Should activate (but we can't easily verify in jsdom without more setup)
      mark.detach();
    });
  });

  describe("topInset option", () => {
    test("uses default topInset of 96", () => {
      const mark = createReadingMark({ container });
      // Can't easily test without layout, but verify option is accepted
      mark.attach();
      mark.detach();
    });

    test("accepts custom topInset", () => {
      const mark = createReadingMark({ container, topInset: 50 });
      mark.attach();
      mark.detach();
    });
  });

  describe("window option", () => {
    test("accepts custom window", () => {
      const customWindow = { innerHeight: 800, scrollBy: () => {} };
      const mark = createReadingMark({ container, window: customWindow });
      mark.attach();
      mark.detach();
    });
  });

  describe("display math handling", () => {
    test("adds sr-unit class to display math elements", () => {
      const mathContainer = document.createElement("div");
      mathContainer.id = "math-container";
      const math = document.createElement("math");
      math.setAttribute("display", "block");
      math.textContent = "E=mc^2";
      mathContainer.appendChild(math);
      document.body.appendChild(mathContainer);

      const mark = createReadingMark({ container: mathContainer });
      mark.attach();
      assert.ok(math.classList.contains("sr-unit"));
      assert.equal(mark.units.length, 1);
      assert.equal(mark.units[0], math);
      mark.detach();
    });
  });

  describe("nested block handling", () => {
    test("does not create units for containers with nested blocks", () => {
      const nested = document.createElement("div");
      nested.id = "nested";
      const li = document.createElement("li");
      const p = document.createElement("p");
      p.textContent = "Nested paragraph.";
      li.appendChild(p);
      nested.appendChild(li);
      document.body.appendChild(nested);

      const mark = createReadingMark({ container: nested });
      mark.attach();
      // The li contains a p, so li is skipped
      // The p inside is processed and its sentences become span.sr-unit
      const units = mark.units.filter(u => u.tagName.toLowerCase() === "span" && u.classList.contains("sr-unit"));
      assert.ok(units.length > 0);
      mark.detach();
    });
  });

  describe("returned controller shape", () => {
    test("returns object with units, idx, active getters and methods", () => {
      const mark = createReadingMark({ container });
      assert.equal(typeof mark.units, "object");
      assert.equal(Array.isArray(mark.units), true);
      assert.equal(typeof mark.idx, "number");
      assert.equal(typeof mark.active, "boolean");
      assert.equal(typeof mark.attach, "function");
      assert.equal(typeof mark.detach, "function");
      assert.equal(typeof mark.activate, "function");
      assert.equal(typeof mark.deactivate, "function");
    });
  });
});