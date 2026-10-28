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

    // Inject scholarly-reader CSS + CSR-specific styles into the shadow root (combined)
    // CSR styles first so they take precedence and tests find them
    const style = doc.createElement("style");
    style.id = "sr-styles";
    style.textContent = `
:host{all:initial}
.csr-root{
  position:fixed;inset:0;z-index:2147483647;
  background:#F2F5F3;color:#16252C;
  font-family:'Literata',Georgia,serif;line-height:1.65;
  display:flex;flex-direction:column;
}
.csr-root *{box-sizing:border-box}
.csr-topbar{
  flex:0 0 auto;display:flex;align-items:center;gap:1rem;
  padding:.6rem 1rem;background:#FBFCFB;border-bottom:1px solid #CBD6D3;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.85rem;color:#5B6C73;
}
.csr-brand{font-weight:600;color:#16252C}
.csr-hint{flex:1 1 auto}
.csr-close{
  appearance:none;border:1px solid #CBD6D3;background:#FBFCFB;border-radius:6px;
  width:1.8rem;height:1.8rem;cursor:pointer;font-size:1rem;color:#16252C;line-height:1;
}
.csr-close:hover{background:#F2F5F3}
.csr-scroll{flex:1 1 auto;overflow-y:auto;padding:2.5rem 1.25rem}
.csr-page{max-width:72ch;margin:0 auto}
/* Issue #10: preserved blocks (tables/figures) that overshoot the 72ch column
   scroll horizontally instead of breaking the layout. img/svg inside figures
   are left alone (they already scale via width: 100%). */
.csr-page figure{max-width:100%;overflow-x:auto;background:#FBFCFB;border:1px solid #CBD6D3;padding:.6rem;margin:1.4rem 0}
.csr-page table{max-width:100%;overflow-x:auto}
.csr-page figure img{display:block;width:100%;height:auto;margin:0}
.csr-page figure object{display:block;width:100%;height:auto;margin:0;pointer-events:none}
.csr-page figcaption{font-size:.8rem;color:#5B6C73;margin-top:.4rem}
.csr-page table{border-collapse:collapse;width:100%;font-size:.88rem;margin:1rem 0}
.csr-page th,.csr-page td{border-bottom:1px solid #CBD6D3;padding:.45rem .5rem;text-align:left;vertical-align:top}
.csr-page a{color:#0E6B73}
.csr-page sup a[data-csr-cite-ref],.csr-page a[data-csr-cite-ref]{cursor:help;text-decoration:underline dotted}
/* Reading mark (sr-* classes from scholarly-reader, plus .rd/.on compat) */
.sr-on{background:rgba(22,37,44,.15);box-shadow:0 0 0 2px rgba(22,37,44,.15);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.csr-root.sr-active .sr-unit:hover:not(.sr-on){background:rgba(22,37,44,.06)}
/* CSR-compat classes */
.rd.on{background:rgba(22,37,44,.15);box-shadow:0 0 0 2px rgba(22,37,44,.15);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.csr-root.rd-active .rd:hover:not(.on){background:rgba(22,37,44,.06)}
.csr-hint-badge{position:absolute;right:.9rem;bottom:.7rem;font:600 .7rem 'Instrument Sans',system-ui,sans-serif;color:#5B6C73;background:#FBFCFB;border:1px solid #CBD6D3;border-radius:6px;padding:.2rem .55rem;opacity:.9;pointer-events:none}
/* Citation peek tooltip */
.csr-peek{
  position:fixed;max-width:32ch;z-index:2147483647;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.78rem;line-height:1.4;color:#16252C;
  background:#FBFCFB;border:1px solid #CBD6D3;border-radius:6px;padding:.5rem .65rem;
  box-shadow:0 4px 14px rgba(22,37,44,.18);pointer-events:none;
}
/* Citation sidebar (issue #9): floats in the right margin, mirroring the TOC */
.csr-citation-sidebar{
  position:fixed;top:4.25rem;right:1rem;width:14rem;
  max-height:calc(100% - 5.75rem);overflow-y:auto;
  display:block;background:none;border:0;z-index:2147483648;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.82rem;line-height:1.35;color:#16252C;
}
.csr-citation-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.csr-citation-list::before{
  content:"Citations";margin:0 0 .6rem .6rem;
  font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5B6C73;
}
.csr-citation-list:empty::before{display:none}
.csr-citation-item{
  display:block;width:100%;appearance:none;border:0;border-left:2px solid #CBD6D3;border-radius:0;
  background:none;padding:.28rem .6rem;font:inherit;color:#5B6C73;text-align:left;cursor:pointer;
}
.csr-citation-item:hover{color:#16252C;background:rgba(22,37,44,.04)}
.csr-citation-item:focus-visible{outline:2px solid #0E6B73;outline-offset:-2px}
.csr-citation-item.active,.csr-citation-item[aria-current]{color:#0E6B73;border-left-color:#0E6B73;font-weight:600}
/* not enough margin: dock as a drawer, like the TOC (and clear of the topbar's close button) */
.csr-root:not(.csr-toc-wide) .csr-citation-sidebar{
  top:3.1rem;bottom:0;max-height:none;width:17rem;padding:1rem;
  background:#FBFCFB;border-left:1px solid #CBD6D3;box-shadow:-4px 0 14px rgba(22,37,44,.12);
}
/* TOC: floats in the left margin, never affects the content column */
.sr-h2,.sr-h3{scroll-margin-top:1rem}
.csr-toc{
  display:none;position:absolute;top:4.25rem;left:1rem;width:14rem;
  max-height:calc(100% - 5.75rem);overflow-y:auto;
  font-family:'Instrument Sans',system-ui,sans-serif;font-size:.82rem;line-height:1.35;
}
.csr-toc-title{font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#5B6C73;margin:0 0 .6rem .6rem}
.csr-toc ul{list-style:none;margin:0;padding:0}
.csr-toc a{display:block;padding:.28rem .6rem;color:#5B6C73;text-decoration:none;border-left:2px solid #CBD6D3}
.csr-toc a.sub{padding-left:1.3rem;font-size:.78rem}
.csr-toc a:hover{color:#16252C;background:rgba(22,37,44,.04)}
.csr-toc a.active{color:#0E6B73;border-left-color:#0E6B73;font-weight:600}
.csr-toc-btn{
  display:none;appearance:none;border:1px solid #CBD6D3;background:#FBFCFB;border-radius:6px;
  height:1.8rem;padding:0 .6rem;cursor:pointer;font:inherit;color:#16252C;
}
/* enough free margin: show TOC in place */
.csr-root.csr-toc-wide .csr-toc{display:block}
/* not enough margin: button + drawer */
.csr-root:not(.csr-toc-wide) .csr-toc-btn{display:inline-block}
.csr-root:not(.csr-toc-wide).csr-toc-open .csr-toc{
  display:block;top:3.1rem;left:0;bottom:0;width:17rem;max-height:none;
  background:#FBFCFB;border-right:1px solid #CBD6D3;padding:1rem;z-index:2;
  box-shadow:4px 0 14px rgba(22,37,44,.12);
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
    // - page (sr-page) -> use as csr-page
    // - main (sr-main) -> keep as main
    // - toc (sr-toc) -> restyle as csr-toc
    // - tocButton (sr-toc-btn) -> restyle as csr-toc-btn

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

    // The scholarly-reader page has class sr-page; rename to csr-page for CSR styles
    page.className = "csr-page";
    scroll.appendChild(page);
    csrRoot.appendChild(scroll);

    // TOC: scholarly-reader returns sr-toc (nav.sr-toc), adapt to csr-toc
    if (toc) {
      toc.className = "csr-toc";
      toc.setAttribute("aria-label", "Table of contents");
      // Update TOC link classes
      toc.querySelectorAll("a").forEach((a) => {
        if (a.classList.contains("sr-toc-sub")) a.classList.add("sub");
      });
      csrRoot.appendChild(toc);

      // TOC button
      if (tocButton) {
        tocButton.className = "csr-toc-btn";
        tocButton.textContent = "Contents";
        tocButton.addEventListener("click", () => csrRoot.classList.toggle("csr-toc-open"));
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
    const tocNav = csrRoot.querySelector(".csr-toc");
    const tocBtn = csrRoot.querySelector(".csr-toc-btn");

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
        csrRoot.classList.toggle("csr-toc-wide", room >= 16.5 * rem);
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
          csrRoot.classList.remove("csr-toc-open");
        };
        item.a.addEventListener("click", handler);
        return [item.a, handler];
      });

      const onToggle = () => csrRoot.classList.toggle("csr-toc-open");
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