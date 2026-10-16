/**
 * Obsidian DataviewJS example — render a paper-digest JSON inline.
 *
 * Paste this into a dataviewjs code block in a note that lives next to your
 * digest JSON file (or point `digestPath` at any vault file).
 *
 * ```dataviewjs
 * const { renderDigest } = await dv.fetch("ui/obsidian-dataviewjs.js") // not needed; inline below
 * ```
 *
 * Usage in a note:
 * ```dataviewjs
 * let digestPath = dv.current().file.folder + "/Vaswani-2017-Neurips-attention_all_you_need.json";
 * await renderPaperDigest(dv, container, digestPath);
 * ```
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ESC[c] || c); }
function confidenceChip(conf) { return `<span class="pd-conf">${conf == null ? 0 : Number(conf)}%</span>`; }
function chipSign(tag) { return { pos: "+", neg: "−", neu: "·" }[tag] || "·"; }
function renderSection(s) {
  const conf = confidenceChip(s.confidence);
  let body = "";
  switch (s.id) {
    case "mot": case "diff": case "core": case "eval":
      body = `<p>${esc(s.content || "")}</p>`;
      if (s.id === "core") {
        if (s.equations?.length) body += s.equations.map(e => `<p>\\[${esc(e)}\\]</p>`).join("");
        if (s.figureId) body += `<figure data-n="${esc(String(s.figureId))}" data-a="${esc(String(s.figureId))}"><figcaption>Framework figure (${esc(String(s.figureId))}).</figcaption></figure>`;
      }
      if (s.id === "eval") {
        if (s.results?.length) body += `<ul class="pd-b">` + s.results.map(r => `<li class="pd-item">${esc(r)}</li>`).join("") + `</ul>`;
        if (s.conclusion) body += `<p class="pd-item">${esc(s.conclusion)}</p>`;
      }
      break;
    case "icymi":
      body = `<ul class="pd-b">` + (s.entries || []).map(e => `<li class="pd-item">${esc(e.text)} <span class="pd-chip pd-${esc(e.tag || "neu")}">${chipSign(e.tag)}</span></li>`).join("") + `</ul>`;
      break;
    case "judge":
      body = `<div class="pd-wrap"><table><thead><tr><th>Question</th><th>Answer</th><th>Conf.</th></tr></thead><tbody>` + (s.rows || []).map(r => `<tr><td>${esc(r.question)}</td><td>${esc(r.answer)}</td><td>${r.conf == null ? "" : r.conf}%</td></tr>`).join("") + `</tbody></table></div>`;
      break;
    case "src":
      body = `<p>${esc(s.content || "")}</p>`;
      break;
    default:
      body = `<p>${esc(s.content || "")}</p>`;
  }
  return `<section><h2 class="pd-s" id="${esc(s.id)}">${esc(s.title)}${conf}</h2>${body}</section>`;
}

function renderDigestHtml(digest, source = {}) {
  const figures = Array.isArray(source.figures) ? source.figures : [];
  const base = source.baseUrl || "";
  const map = {};
  figures.forEach((f, i) => { const key = String(f.n != null ? f.n : i + 1); map[key] = f.src || f.dataA || ""; });
  const mapJson = JSON.stringify(map);
  const navLinks = (digest.sections || []).map(s => `<a href="#${esc(s.id)}">${esc(s.title)}</a>`).join("");
  const sectionsHtml = (digest.sections || []).map(s => renderSection(s)).join("");
  const srcSection = (digest.sections || []).find(s => s.id === "src") || {};
  const citationsHtml = (srcSection.citations || []).map(c => `<p class="pd-cite mt-1">${esc(c)}</p>`).join("");
  const mapJs = Object.entries(map).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
  let html = TEMPLATE;
  for (const [token, value] of Object.entries({
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
  })) html = html.split(token).join(value);
  return html.replace("const MAP = {{MAP}};", `const MAP = {\n${mapJs}\n  };`);
}

const TEMPLATE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>{{TITLE}} — Paper Digest</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6;color:#1e293b;max-width:72ch;margin:0 auto;padding:1.5rem}h1{font-size:1.5rem;margin-bottom:.5rem}h2{margin-top:1.2rem}nav{position:sticky;top:0;background:#f8fafc;border-bottom:1px solid #e2e8f0;z-index:20;padding:.4rem .8rem}nav a{display:block;padding:.4em .8em;font-size:.85em;color:#475569;text-decoration:none}nav a:hover{background:#f1f5f9}.conf{font-size:.75em;opacity:.7;margin-left:.5em}.chip{display:inline-block;padding:.05em .4em;border-radius:.35em;font-size:.75em;margin-left:.35em}.pd-chip.pos{background:#e7f7ec;color:#166534}.pd-chip.neg{background:#fdecea;color:#991b1b}.pd-chip.neu{background:#f1f5f9;color:#334155}.pd-wrap{overflow-x:auto;margin:1em 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:.4em .6em;text-align:left;font-size:.9em}th{background:#f8fafc}figure{margin:1em 0;text-align:center}figure img{max-width:100%;height:auto;border:1px solid #e2e8f0}figcaption{font-size:.85em;color:#475569;margin-top:.4em}.pd-cite{font-size:.8em;color:#64748b;margin-top:.2em}.pd-b li{margin:.25em 0}.pd-s{margin-top:1.2em}</style></head><body><nav>{{NAV_LINKS}}</nav><article><header><h1>{{TITLE}}</h1><p>{{AUTHORS}} — {{VENUE}} ({{ID}})</p><p><b>Read:</b> {{WHAT_READ}}</p><div style="padding:.75rem;border:1px solid #bae6fd;background:#eff6ff;border-radius:.5rem;margin-top:.75rem"><p>{{VERDICT}}</p><p style="font-size:.875rem;color:#64748b;margin-top:.25rem"><b>Overall confidence:</b> {{OVERALL_CONF}}%</p></div></header>{{SECTIONS}}<section id="src" style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e2e8f0"><h2 class="pd-s" id="src">Sources and limits<span class="pd-conf">{{SRC_CONF}}%</span></h2><p>{{SRC_CONTENT}}</p>{{CITATIONS}}</section></article><script>const BASE="{{BASE}}";const MAP={{MAP}};window.addEventListener("load",()=>{document.querySelectorAll("figure[data-n]").forEach(fig=>{const n=fig.getAttribute("data-n");const file=MAP&&MAP[n];const img=fig.querySelector("img");if(!img&&file){const a=document.createElement("a");a.href=new URL(file,BASE).href;a.target="_blank";a.rel="noopener";a.textContent="Open figure on arXiv";a.style.display="block";a.style.marginTop=".5rem";a.style.color="#475569";fig.appendChild(a)}});document.querySelectorAll("figure img").forEach(img=>{img.addEventListener("error",()=>{const fig=img.closest("figure");const n=fig?fig.getAttribute("data-n"):null;const file=n&&MAP&&MAP[n];const url=file?new URL(file,BASE).href:img.src;const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";a.textContent="Open figure on arXiv";a.style.display="block";a.style.marginTop=".5rem";a.style.color="#475569";img.replaceWith(a)})}})</script></body></html>`;

window.renderPaperDigest = async function renderPaperDigest(dv, container, digestPath) {
  container.empty();
  container.createEl("div", { text: "Loading digest…", cls: "pd-loading" });
  try {
    const text = await dv.io.load(digestPath);
    const digest = JSON.parse(text);
    const source = { figures: digest.figures || [], baseUrl: digest.baseUrl || "" };
    const html = renderDigestHtml(digest, source);
    const wrapper = container.createDiv({ cls: "paper-digest" });
    wrapper.innerHTML = html;
    container.querySelector(".pd-loading")?.remove();
    // Obsidian will re-run MathJax on the new DOM shortly.
  } catch (e) {
    container.empty();
    container.createEl("div", { text: `Failed to render ${digestPath}: ${e.message}`, cls: "pd-error" });
  }
};
