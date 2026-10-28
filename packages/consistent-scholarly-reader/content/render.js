// Builds the reading-mode overlay: a full-viewport Shadow DOM host appended
// to the page, so the publisher site's own CSS can never bleed into (or be
// bled into by) the reading-mode styling.
(function () {
  "use strict";
  const CSR = window.CSR;

  // Persistent reader location across open/close (issue #7): the section that
  // was reading-marked when the overlay was last torn down, so re-opening can
  // position the reader at the same place; and the page scroll captured on the
  // current enter so teardown can restore it (bidirectional, mapped by section
  // anchor rather than raw pixels so it survives different DOMs).
  let readerLocation = { sectionId: null };
  let capturedPageScroll = null;
  let lastMain = null;
  let layoutDisposer = null;

  // Build stamp: short commit hash of the source this content script was built
  // from. Open DevTools Console on the publisher page and inspect
  // `CSR.readerCommit` to verify which build is actually loaded.
  CSR.readerCommit = "145a777";
  console.debug("Consistent Scholarly Reader content script build", CSR.readerCommit);

  function currentPageScroll() {
    return document.documentElement ? document.documentElement.scrollTop : 0;
  }

  // Section id (heading anchor) that contains `node` within `main`. Mirrors the
  // reader's structure: main children alternate h2.sr-h2 headings + content blocks.
  function sectionIdForNode(node, main) {
    let block = node;
    while (block && block.parentNode !== main) block = block.parentNode;
    if (!block) return null;
    let lastH2 = null;
    for (const child of main.childNodes) {
      if (child === block) break;
      if (child.nodeType === 1 && child.tagName === "H2" && child.classList.contains("sr-h2")) lastH2 = child;
    }
    return lastH2 ? lastH2.id : null;
  }

  // Scroll `.csr-scroll` to the section whose heading has `sectionId`. Uses the
  // heading's real offset when available, otherwise a synthetic position based
  // on section order so the reader lands below the top for non-first sections.
  function scrollToSectionId(scroll, main, sectionId) {
    if (!sectionId) return 0;
    const headings = Array.from(main.querySelectorAll("h2.sr-h2"));
    const heading = headings.find((h) => h.id === sectionId);
    if (!heading) return 0;
    const headingRect = heading.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    let offset = headingRect.top - scrollRect.top;
    // Zero rects (Node shim, or element not yet laid out): fall back to a
    // synthetic position based on section order so the reader lands below the
    // top for non-first sections.
    if (!offset && headings.indexOf(heading) > 0) {
      offset = headings.indexOf(heading) * 200;
    }
    scroll.scrollTop = offset;
    return offset;
  }

  // Resolve the anchor id for the section containing heading `h`. Most
  // publishers (arXiv, IEEE, Science) put the section id on a container
  // element around the heading (e.g. .ltx_section, .section), not on the
  // heading itself; ACM instead puts it on the heading. Prefer the nearest
  // id'd ancestor of the heading, falling back to the heading's own id, so
  // the returned id matches the reader's section id (parsers key off sec.id).
  function sectionIdForHeading(h) {
    let node = h.parentElement;
    while (node && node.nodeType === 1) {
      if (node.id) return node.id;
      node = node.parentElement;
    }
    return h.id || null;
  }

  // Detect which publisher-page section is closest to the current scroll
  // position, so first-time entry to reading mode can open the reader at
  // approximately the same place the user was reading. The heading's anchor id
  // is resolved from its section container (the nearest id'd ancestor; see
  // sectionIdForHeading) because arXiv/IEEE/Science carry the section id on the
  // wrapper around the heading rather than on the heading element itself.
  // Returns the closest heading (with its resolved id and absolute top), or
  // null when the page has no headings at all.
  function capturePageSection(doc) {
    const y = currentPageScroll();
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    if (!headings.length) return null;
    const withPos = headings.map((h) => {
      const rect = h.getBoundingClientRect();
      const absTop = rect.top + y; // viewport-relative top + document scroll = absolute top
      return { el: h, id: sectionIdForHeading(h), top: absTop };
    });
    let lastAtOrAbove = null;
    let firstBelow = null;
    for (const wp of withPos) {
      if (wp.top <= y + 64) { // tolerance for fixed topbar
        if (!lastAtOrAbove || wp.top > lastAtOrAbove.top) lastAtOrAbove = wp;
      } else if (!firstBelow) {
        firstBelow = wp;
      }
    }
    return lastAtOrAbove || firstBelow || withPos[0];
  }

  // Ordinal of heading `el` among all page headings h1-h6 in document order.
  // Used as a last-resort mapping when page sections carry no usable id: reader
  // sections (h2.sr-h2) are rendered in article order, so the nth page section maps
  // to reader h2.sr-h2[n] (best effort; may be off by the title/subsections).
  function pageSectionOrdinal(el, doc) {
    if (!el) return null;
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    return headings.indexOf(el);
  }

  // Clamp preserved blocks (tables/figures) whose computed width overshoots the
  // 72ch reader column so they scroll horizontally instead of breaking layout.
  function clampOversizedBlocks(root) {
    const limit = 72 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    root.querySelectorAll("table, figure").forEach((el) => {
      const width = parseFloat(getComputedStyle(el).width) || 0;
      if (width > limit) {
        el.style.maxWidth = "100%";
        el.style.overflowX = "auto";
      }
    });
  }

  // Convert CSR article model to scholarly-reader model
  function toScholarlyModel(article) {
    // Map sections to scholarly-reader sections with 'nodes' blocks
    // (the section content is already a sanitized DocumentFragment)
    const sections = (article.sections || []).map((sec) => ({
      id: sec.id,
      title: sec.title,
      blocks: sec.content ? [{ type: "nodes", nodes: sec.content }] : [],
    }));

    // Header: map CSR fields to scholarly-reader header
    const header = {
      title: article.title || "",
      authors: article.authors || "",
      kicker: article.venueLine || "",
      kickerHref: article.sourceUrl || null,
      verdict: null, // CSR doesn't have a verdict concept
    };

    return { header, sections, figures: [] };
  }

  CSR.renderOverlay = function renderOverlay(article) {
    // Ensure ScholarlyReader is available
    if (!window.ScholarlyReader || !window.ScholarlyReader.buildDocument || !window.ScholarlyReader.mountLayout) {
      console.error("CSR: ScholarlyReader not loaded before render.js");
      return;
    }
    const { CSS, buildDocument, mountLayout, ensureFonts, removeFonts } = window.ScholarlyReader;

    // Capture the page scroll on enter so teardown can restore it (issue #7).
    capturedPageScroll = currentPageScroll();
    // Determine the section to open at: the page's current in-view section,
    // mapped by heading anchor, evaluated on EVERY entry so re-opening follows
    // where the user is now reading rather than a stale reading mark from a
    // previous session (issue #7). Prefer the section's anchor id (matches the
    // reader's h2.sr-h2 ids, which parsers key off sec.id). Only when the page has
    // no usable heading anchor fall back to the section saved from the last
    // teardown, then to ordinal mapping so the reader never opens at the top
    // just because the page's sections lack ids.
    const pageSection = capturePageSection(document);
    const sectionId = (pageSection && pageSection.id) || readerLocation.sectionId || null;
    const sectionOrdinal = pageSection ? pageSectionOrdinal(pageSection.el, document) : null;
    readerLocation = { sectionId, sectionOrdinal };

    // Ensure fonts in the host document (fonts don't work inside shadow roots)
    ensureFonts(document);

    const host = document.createElement("div");
    host.id = "csr-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });

    // Create a document for the shadow root
    const doc = shadow.ownerDocument;

    // Inject scholarly-reader CSS + CSR-specific shell styles into the shadow root
    // Scholarly-reader CSS (CSS) provides all content styling: figures, tables, ToC, reading mark, themes
    // CSR adds only the overlay shell: root, topbar, scroll, citation sidebar, peek, hint
    const style = doc.createElement("style");
    style.id = "sr-styles";
    style.textContent = `
:host{all:initial}
.csr-root{
  position:fixed;inset:0;z-index:2147483647;
  background:var(--sr-paper);color:var(--sr-ink);
  font-family:'Literata',Georgia,serif;line-height:1.65;
  display:flex;flex-direction:column;
}
.csr-root *{box-sizing:border-box}
.csr-topbar{
  flex:0 0 auto;display:flex;align-items:center;gap:1rem;
  padding:.6rem 1rem;background:var(--sr-card);border-bottom:1px solid var(--sr-rule);
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.85rem;color:var(--sr-mute);
}
.csr-brand{font-weight:600;color:var(--sr-ink)}
.csr-hint{flex:1 1 auto}
.csr-close{
  appearance:none;border:1px solid var(--sr-rule);background:var(--sr-card);border-radius:6px;
  width:1.8rem;height:1.8rem;cursor:pointer;font-size:1rem;color:var(--sr-ink);line-height:1;
}
.csr-close:hover{background:var(--sr-paper)}
.csr-scroll{flex:1 1 auto;overflow-y:auto;padding:2.5rem 1.25rem}
.sr-page{max-width:72ch;margin:0 auto}
/* Citation peek tooltip */
.csr-peek{
  position:fixed;max-width:32ch;z-index:2147483647;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.78rem;line-height:1.4;color:var(--sr-ink);
  background:var(--sr-card);border:1px solid var(--sr-rule);border-radius:6px;padding:.5rem .65rem;
  box-shadow:0 4px 14px rgba(22,37,44,.18);pointer-events:none;
}
/* Citation sidebar (issue #9): floats in the right margin, mirroring the TOC */
.csr-citation-sidebar{
  position:fixed;top:4.25rem;right:1rem;width:14rem;
  max-height:calc(100% - 5.75rem);overflow-y:auto;
  display:block;background:none;border:0;z-index:2147483648;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.82rem;line-height:1.35;color:var(--sr-ink);
}
.csr-citation-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.csr-citation-list::before{
  content:"Citations";margin:0 0 .6rem .6rem;
  font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--sr-mute);
}
.csr-citation-list:empty::before{display:none}
.csr-citation-item{
  display:block;width:100%;appearance:none;border:0;border-left:2px solid var(--sr-rule);border-radius:0;
  background:none;padding:.28rem .6rem;font:inherit;color:var(--sr-mute);text-align:left;cursor:pointer;
}
.csr-citation-item:hover{color:var(--sr-ink);background:rgba(22,37,44,.04)}
.csr-citation-item:focus-visible{outline:2px solid var(--sr-teal);outline-offset:-2px}
.csr-citation-item.active,.csr-citation-item[aria-current]{color:var(--sr-teal);border-left-color:var(--sr-teal);font-weight:600}
/* not enough margin: dock as a drawer, like the TOC (and clear of the topbar's close button) */
.csr-root:not(.sr-toc-wide) .csr-citation-sidebar{
  top:3.1rem;bottom:0;max-height:none;width:17rem;padding:1rem;
  background:var(--sr-card);border-left:1px solid var(--sr-rule);box-shadow:-4px 0 14px rgba(22,37,44,.12);
}
/* CSR hint badge (positioned in topbar via .csr-hint, not fixed) */
.csr-hint-badge{
  font:600 .7rem 'Instrument Sans',system-ui,sans-serif;
  color:var(--sr-mute);opacity:.9;pointer-events:none;
}
` + CSS;
    shadow.appendChild(style);

    // Build the document structure using scholarly-reader
    const model = toScholarlyModel(article);
    const { root, page, main, toc, tocButton } = buildDocument(model, {
      document: doc,
      // CSR doesn't use markdown/html blocks; sections are pre-parsed DOM nodes
      markdown: () => { throw new Error("markdown block not used in CSR"); },
      sanitize: (html) => html, // nodes bypass sanitizer
    });

    // Adapt the structure for CSR:
    // - root (sr-root) -> wrap in csr-root
    // - page (sr-page) -> keep as sr-page (scholarly-reader CSS styles it)
    // - main (sr-main) -> keep as main
    // - toc (sr-toc) -> keep as sr-toc (scholarly-reader CSS styles it)
    // - tocButton (sr-toc-btn) -> keep as sr-toc-btn (scholarly-reader CSS styles it)

    // Wrap sr-root in csr-root
    const csrRoot = doc.createElement("div");
    csrRoot.className = "csr-root";
    csrRoot.id = "csr-root";

    // Topbar
    const topbar = doc.createElement("div");
    topbar.className = "csr-topbar";
    topbar.innerHTML = `<span class="csr-brand">Reading mode</span><span class="csr-hint">Press <b>R</b> for the reading mark · <b>\u2191</b>/<b>\u2193</b> or <b>k</b>/<b>j</b> to move it · hover a citation to peek it</span>`;
    const closeBtn = doc.createElement("button");
    closeBtn.className = "csr-close";
    closeBtn.setAttribute("aria-label", "Exit reading mode");
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", () => CSR.teardownOverlay());
    topbar.appendChild(closeBtn);
    csrRoot.appendChild(topbar);

    // Scroll container with page
    const scroll = doc.createElement("div");
    scroll.className = "csr-scroll";

    // Keep sr-page class (scholarly-reader CSS styles .sr-page)
    // No rename needed - scholarly-reader CSS handles figure/table/ToC/content styling
    scroll.appendChild(page);
    csrRoot.appendChild(scroll);

    // TOC: keep sr-toc class (scholarly-reader CSS styles .sr-toc)
    if (toc) {
      toc.setAttribute("aria-label", "Table of contents");
      // Update TOC link classes: sr-toc-sub -> sub (for backward compat with SR CSS)
      toc.querySelectorAll("a").forEach((a) => {
        if (a.classList.contains("sr-toc-sub")) a.classList.add("sub");
      });
      csrRoot.appendChild(toc);

      // TOC button: keep sr-toc-btn class (scholarly-reader CSS styles .sr-toc-btn)
      if (tocButton) {
        tocButton.textContent = "Contents";
        tocButton.addEventListener("click", () => csrRoot.classList.toggle("sr-toc-open"));
        topbar.insertBefore(tocButton, closeBtn);
      }
    }

    shadow.appendChild(csrRoot);

    document.documentElement.appendChild(host);
    document.documentElement.style.overflow = "hidden";

    // Wire up ToC layout (scroll-spy, drawer, toggle)
    // CSR-specific mountLayout (adapted from scholarly-reader's mountLayout)
    const win = shadow.defaultView || window;
    const scroller = scroll; // CSR uses .csr-scroll as scroller
    const tocNav = csrRoot.querySelector(".sr-toc");
    const tocBtn = csrRoot.querySelector(".sr-toc-btn");

    if (tocNav) {
      const headings = new Map();
      for (const h of Array.from(page.querySelectorAll("h2.sr-h2, h3"))) headings.set(h.id, h);
      const links = [];
      for (const a of Array.from(tocNav.querySelectorAll("a"))) {
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
          item.a.classList.toggle("active", item === cur);
          if (item === cur) item.a.setAttribute("aria-current", "true");
          else item.a.removeAttribute("aria-current");
        }
        const l = cur.a;
        if (l.offsetTop < tocNav.scrollTop || l.offsetTop + l.offsetHeight > tocNav.scrollTop + tocNav.clientHeight) {
          tocNav.scrollTop = l.offsetTop - tocNav.clientHeight / 2;
        }
      };
      const schedule = () => {
        if (ticking) return;
        ticking = true;
        if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(update);
        else update();
      };

      // Responsive: show floating TOC only if left margin is wide enough
      const measure = () => {
        const style = win.getComputedStyle ? win.getComputedStyle(doc.documentElement) : null;
        const rem = (style && parseFloat(style.fontSize)) || 16;
        const scrollLeft = isWindow ? 0 : scroller.getBoundingClientRect().left;
        const room = page.getBoundingClientRect().left - scrollLeft;
        csrRoot.classList.toggle("sr-toc-wide", room >= 16.5 * rem);
      };
      let observer = null;
      if (typeof win.ResizeObserver === "function") {
        observer = new win.ResizeObserver(measure);
        observer.observe(csrRoot);
      } else {
        measure();
      }

      const onScroll = () => schedule();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      schedule();

      const onWheel = (e) => {
        if (tocNav.scrollHeight > tocNav.clientHeight) return;
        if (isWindow) win.scrollBy(0, e.deltaY);
        else scroller.scrollBy({ top: e.deltaY });
      };
      tocNav.addEventListener("wheel", onWheel, { passive: true });

      const linkHandlers = links.map((item) => {
        const handler = (e) => {
          e.preventDefault();
          item.target.scrollIntoView({ block: "start", behavior: "smooth" });
          csrRoot.classList.remove("sr-toc-open");
        };
        item.a.addEventListener("click", handler);
        return [item.a, handler];
      });

      const onToggle = () => csrRoot.classList.toggle("sr-toc-open");
      if (tocBtn) tocBtn.addEventListener("click", onToggle);

      layoutDisposer = {
        dispose() {
          scroller.removeEventListener("scroll", onScroll);
          tocNav.removeEventListener("wheel", onWheel);
          for (const [a, handler] of linkHandlers) a.removeEventListener("click", handler);
          if (tocBtn) tocBtn.removeEventListener("click", onToggle);
          if (observer) observer.disconnect();
        },
      };
    }

    lastMain = main;
    clampOversizedBlocks(main); // issue #10

    // Scroll to the target section (issue #7)
    if (sectionId) {
      scrollToSectionId(scroll, main, sectionId);
    } else if (sectionOrdinal != null && sectionOrdinal > 0) {
      const headings = main.querySelectorAll("h2.sr-h2");
      const target = headings[sectionOrdinal];
      if (target) {
        const rect = target.getBoundingClientRect();
        const srect = scroll.getBoundingClientRect();
        scroll.scrollTop = rect.top - srect.top;
      }
    }

    CSR.readingMark.attach(shadow, csrRoot);
    CSR.citationPeek.attach(shadow, article.bibliography);

    // Initialize theme selector in the shadow DOM (bottom-left to avoid sr-hint at bottom-right)
    // Pass csrRoot as parent since shadow DOM doesn't have a traditional body element
    if (window.ScholarlyReader && window.ScholarlyReader.attachThemeSelector) {
      const doc = shadow.ownerDocument;
      CSR.themeDisposer = window.ScholarlyReader.attachThemeSelector(doc, { position: 'bottom-left', parent: csrRoot });
    }

    // Issue #9: citation sidebar — wire into the reading mark so the panel
    // updates as the mark moves. citationSidebar.js is registered in the
    // manifest, so CSR.citationSidebar exists in the real extension; guard
    // for sandboxes that load render.js without it.
    if (CSR.citationSidebar) {
      CSR.citationSidebar.attach(shadow, csrRoot, article.bibliography);
      if (CSR.readingMark.idx >= 0) {
        CSR.citationSidebar.setActiveUnit(CSR.readingMark.units[CSR.readingMark.idx]);
      }
      CSR.readingMark.onCitationUnitChange = (unit) => CSR.citationSidebar.setActiveUnit(unit);
    }

    return { host, shadow, root: csrRoot, scroll };
  };

  CSR.teardownOverlay = function teardownOverlay() {
    const host = document.getElementById("csr-overlay-host");
    if (!host) return;
    // Remember the reading-marked section BEFORE detach() clears units/idx
    // (issue #7), mapped by section anchor so it survives the reader's rebuilt
    // DOM. No active mark (idx < 0) or no lastMain => nothing to preserve.
    let markSectionId = null;
    if (CSR.readingMark && CSR.readingMark.units && CSR.readingMark.idx >= 0 && lastMain) {
      markSectionId = sectionIdForNode(CSR.readingMark.units[CSR.readingMark.idx], lastMain) || null;
    }
    readerLocation = { sectionId: markSectionId };
    CSR.readingMark.detach();
    CSR.citationPeek.detach();
    // Issue #9: drop the citation sidebar and stop driving it from the mark.
    if (CSR.citationSidebar) {
      CSR.citationSidebar.detach();
      CSR.readingMark.onCitationUnitChange = null;
    }
    if (layoutDisposer) {
      layoutDisposer.dispose();
      layoutDisposer = null;
    }
    if (CSR.themeDisposer) {
      CSR.themeDisposer.dispose();
      CSR.themeDisposer = null;
    }
    if (markSectionId) {
      // Jump back to the section containing the active reading mark, mapped by
      // anchor id onto the publisher page (issue #7). If the anchor is absent
      // from the page, or the page lacks scrollIntoView (e.g. a test shim),
      // fall back to the scroll captured on enter.
      const target = document.getElementById(markSectionId);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        document.documentElement.scrollTop = capturedPageScroll;
      }
    } else {
      // No reading mark (or no matching page anchor): restore the page scroll
      // captured on enter (issue #7).
      document.documentElement.scrollTop = capturedPageScroll;
    }
    capturedPageScroll = null;
    host.remove();
    if (window.ScholarlyReader && window.ScholarlyReader.removeFonts) {
      window.ScholarlyReader.removeFonts(document);
    }
    document.documentElement.style.overflow = "";
  };
})();