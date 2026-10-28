// Reading mark wrapper using scholarly-reader's createReadingMark.
// Provides the CSR API (units, idx, onCitationUnitChange, attach, detach)
// while delegating to the shared implementation.
(function () {
  "use strict";
  const CSR = window.CSR;

  // Ensure ScholarlyReader is available
  if (!window.ScholarlyReader || !window.ScholarlyReader.createReadingMark) {
    console.error("CSR: ScholarlyReader not loaded before readingMark.js");
    return;
  }

  const { createReadingMark, DEFAULT_UNIT_SELECTOR } = window.ScholarlyReader;

  let readingMark = null;

  // Expose the active-unit state (live) so renderOverlay's teardown can
  // capture the reading-marked section before detaching (issue #7).
  CSR.readingMark = {
    get units() {
      return readingMark ? readingMark.units : [];
    },
    get idx() {
      return readingMark ? readingMark.idx : -1;
    },
    // Set by renderOverlay to drive the citation sidebar as the mark moves.
    onCitationUnitChange: null,

    attach(shadowRoot, rootEl) {
      const page = shadowRoot.querySelector(".csr-page");
      const scroller = shadowRoot.querySelector(".csr-scroll");
      const activeTarget = rootEl;
      const hintParent = rootEl;
      const keyTarget = document;

      if (!page) {
        console.error("CSR: .csr-page not found in shadow root");
        return;
      }

      readingMark = createReadingMark({
        container: page,
        window: shadowRoot.defaultView,
        scroller: scroller || shadowRoot.defaultView,
        unitSelector: DEFAULT_UNIT_SELECTOR,
        activeTarget,
        hintParent,
        keyTarget,
        topInset: 96,
        onUnitChange: (unit) => {
          if (typeof CSR.readingMark.onCitationUnitChange === "function") {
            CSR.readingMark.onCitationUnitChange(unit);
          }
        },
      });

      readingMark.attach();

      // Add CSR-compatibility classes (.rd, .on, .rd-active) in addition to
      // scholarly-reader's (.sr-unit, .sr-on, .sr-active) so existing tests
      // and stylesheet continue to work during migration.
      for (const unit of readingMark.units) {
        unit.classList.add("rd");
      }
      const originalActivate = readingMark.activate;
      readingMark.activate = function(i) {
        originalActivate.call(this, i);
        if (activeTarget) activeTarget.classList.add("rd-active");
      };
      const originalDeactivate = readingMark.deactivate;
      readingMark.deactivate = function() {
        originalDeactivate.call(this);
        if (activeTarget) activeTarget.classList.remove("rd-active");
      };
      const originalSet = readingMark.set;
      readingMark.set = function(i, scroll, fast) {
        originalSet.call(this, i, scroll, fast);
        for (const unit of readingMark.units) {
          unit.classList.remove("on");
        }
        if (readingMark.units[readingMark.idx]) {
          readingMark.units[readingMark.idx].classList.add("on");
        }
      };
    },

    detach() {
      if (readingMark) {
        readingMark.detach();
        readingMark = null;
      }
    },
  };
})();