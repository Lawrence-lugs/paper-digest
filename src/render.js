/**
 * Pure digest JSON -> HTML renderer. No filesystem, no network: safe to use
 * in Node, in a browser, and inside Obsidian dataviewjs.
 *
 * Renders a digest JSON object (as produced by the agent in src/prompt.js)
 * into assets/template.html markup.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c] || c);
}

/**
 * Normalize LaTeX math delimiters and escapes. Agents commonly emit doubled
 * backslashes before delimiters (e.g. `\\(` instead of `\(`) because their
 * output was double-escaped through JSON. Collapse `\\X` → `\X` for math
 * delimiters and common LaTeX escapes so MathJax recognizes them.
 */
function normalizeLatex(s) {
  const t = String(s);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "\\") {
      const next = t[i + 2];
      // Collapse \\X → \X for math delimiters and LaTeX command letters so
      // MathJax recognizes them. \\ (line break, before space/end) is kept.
      if (next && ("[(){}_]".includes(next) || /[a-zA-Z]/.test(next))) {
        out.push("\\", next);
        i += 2;
      } else {
        out.push("\\", "\\");
        i += 1;
      }
    } else {
      out.push(t[i]);
    }
  }
  return out.join("");
}

/**
 * Strip existing math delimiters from an equation string so the template can
 * re-wrap it consistently in `\[` `\]`.
 */
function stripMathDelimiters(s) {
  return String(s)
    .replace(/^\\\[\s*/, "")
    .replace(/\s*\\\]$/, "")
    .replace(/^\\\(\s*/, "")
    .replace(/\s*\\\)$/, "");
}

function confidenceChip(conf) {
  const c = conf == null ? 0 : Number(conf);
  return `<span class="conf">${c}%</span>`;
}

function chipSign(tag) {
  return { pos: "+", neg: "−", neu: "·" }[tag] || "·";
}

function renderSection(s) {
  const conf = confidenceChip(s.confidence);
  let body = "";
  switch (s.id) {
    case "mot":
    case "diff":
    case "core":
    case "eval":
      body = `<p>${esc(normalizeLatex(s.content || ""))}</p>`;
      if (s.id === "core") {
        if (s.equations && s.equations.length) {
          body += s.equations
            .map((e) => {
              const clean = stripMathDelimiters(normalizeLatex(e));
              return `<p>\\[${esc(normalizeLatex(clean))}\\]</p>`;
            })
            .join("");
        }
        if (s.figureId) {
          body += `<figure data-n="${esc(String(s.figureId))}" data-a="${esc(String(s.figureId))}"><figcaption>Framework figure (${esc(String(s.figureId))}).</figcaption></figure>`;
        }
      }
      if (s.id === "eval") {
        if (s.results && s.results.length) {
          body +=
            `<ul class="b">` +
            s.results.map((r) => `<li class="item">${esc(r)}</li>`).join("") +
            `</ul>`;
        }
        if (s.conclusion) {
          body += `<p class="item">${esc(s.conclusion)}</p>`;
        }
      }
      break;
    case "icymi":
      body =
        `<ul class="b">` +
        (s.entries || []).map(
          (e) =>
            `<li class="item">${esc(e.text)} <span class="chip ${esc(
              e.tag || "neu"
            )}">${chipSign(e.tag)}</span></li>`
        ).join("") +
        `</ul>`;
      break;
    case "judge":
      body =
        `<div class="wrap"><table><thead><tr><th>Question</th><th>Answer</th><th>Conf.</th></tr></thead><tbody>` +
        (s.rows || []).map(
          (r) =>
            `<tr><td>${esc(r.question)}</td><td>${esc(r.answer)}</td><td>${
              r.conf == null ? "" : r.conf
            }%</td></tr>`
        ).join("") +
        `</tbody></table></div>`;
      break;
    case "src":
      body = `<p>${esc(s.content || "")}</p>`;
      break;
    default:
      body = `<p>${esc(s.content || "")}</p>`;
  }
  return `<section><h2 class="s" id="${esc(s.id)}">${esc(s.title)}${conf}</h2>${body}</section>`;
}

/**
 * Render a digest JSON object into a complete HTML document string.
 *
 * @param {object} digest - parsed digest object
 * @param {object} [source] - resolved source (figures, baseUrl) for the figure pipeline
 * @returns {string} HTML
 */
export function render(digest, source = {}) {
  const figures = Array.isArray(source.figures) ? source.figures : [];
  const base = source.baseUrl || "";

  const map = {};
  figures.forEach((f, i) => {
    const key = String(f.n != null ? f.n : i + 1);
    map[key] = f.src || f.dataA || "";
  });
  const mapJson = JSON.stringify(map);

  const navLinks = (digest.sections || [])
    .map((s) => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`)
    .join("");

  const sectionsHtml = (digest.sections || []).map((s) => renderSection(s)).join("");

  const srcSection = (digest.sections || []).find((s) => s.id === "src") || {};
  const citationsHtml = (srcSection.citations || [])
    .map((c) => `<p class="cite mt-1">${esc(c)}</p>`)
    .join("");

  const mapJs = Object.entries(map)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");

  // assets/template.html is read separately and placeholders replaced here.
  const placeholders = {
    "{{TITLE}}": esc(digest.title || ""),
    "{{AUTHORS}}": esc((digest.authors || []).join(", ")),
    "{{VENUE}}": esc(digest.venue || ""),
    "{{ID}}": esc(digest.id || ""),
    "{{WHAT_READ}}": esc(digest.whatRead || ""),
    "{{VERDICT}}": esc(digest.verdict || ""),
    "{{OVERALL_CONF}}": esc(digest.overallConfidence || 0),
    "{{SECTIONS}}": sectionsHtml,
    "{{SRC_CONF}}": esc(srcSection.confidence || 0),
    "{{SRC_CONTENT}}": esc(srcSection.content || ""),
    "{{CITATIONS}}": citationsHtml,
    "{{NAV_LINKS}}": navLinks,
    "{{BASE}}": esc(base),
    "{{MAP}}": mapJson,
  };

  return { placeholders, mapJs };
}

export { esc as escapeHtml };
