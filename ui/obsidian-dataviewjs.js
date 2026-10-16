/**
 * Obsidian DataviewJS example — render a paper-digest JSON inline.
 *
 * Paste this into a dataviewjs code block in a note that lives next to your
 * digest JSON file (or point `digestPath` at any vault file).
 *
 * ```dataviewjs
 * let digestPath = dv.current().file.folder + "/Vaswani-2017-Neurips-attention_all_you_need.json";
 * await renderPaperDigest(dv, container, digestPath);
 * ```
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ESC[c] || c); }
function normalizeLatex(s) { const t=String(s);const out=[];const DELIM="[(){}_]";for(let i=0;i<t.length;i++){const c=t[i];if(c==="\\"&&i+2<t.length&&t[i+1]==="\\"&&DELIM.includes(t[i+2])){out.push("\\",t[i+2]);i+=2}else{out.push(c)}}return out.join(""); }
function stripMathDelimiters(s) { return String(s).replace(/^\\\[\s*/, "").replace(/\s*\\\]$/, "").replace(/^\\\(\s*/, "").replace(/\s*\\\)$/, ""); }
function confidenceChip(conf) { return `<span class="conf">${conf == null ? 0 : Number(conf)}%</span>`; }
function chipSign(tag) { return { pos: "+", neg: "−", neu: "·" }[tag] || "·"; }
function renderSection(s) {
  const conf = confidenceChip(s.confidence);
  let body = "";
  switch (s.id) {
    case "mot": case "diff": case "core": case "eval":
      body = `<p>${esc(normalizeLatex(s.content || ""))}</p>`;
      if (s.id === "core") {
        if (s.equations?.length) body += s.equations.map(e => { const clean = stripMathDelimiters(normalizeLatex(e)); return `<p>\\[${esc(normalizeLatex(clean))}\\]</p>`; }).join("");
        if (s.figureId) body += `<figure data-n="${esc(String(s.figureId))}" data-a="${esc(String(s.figureId))}"><figcaption>Framework figure (${esc(String(s.figureId))}).</figcaption></figure>`;
      }
      if (s.id === "eval") {
        if (s.results?.length) body += `<ul class="b">` + s.results.map(r => `<li class="item">${esc(r)}</li>`).join("") + `</ul>`;
        if (s.conclusion) body += `<p class="item">${esc(s.conclusion)}</p>`;
      }
      break;
    case "icymi":
      body = (s.entries || []).map(e => `<div class="item"><span class="chip ${esc(e.tag || "neu")}">${chipSign(e.tag)}</span>${esc(e.text)}</div>`).join("");
      break;
    case "judge":
      body = `<div class="wrap"><table><thead><tr><th>Question</th><th>Answer</th><th>Conf.</th></tr></thead><tbody>` + (s.rows || []).map(r => `<tr><td>${esc(r.question)}</td><td>${esc(r.answer)}</td><td>${r.conf == null ? "" : r.conf}%</td></tr>`).join("") + `</tbody></table></div>`;
      break;
    case "src":
      body = `<p>${esc(s.content || "")}</p>`;
      break;
    default:
      body = `<p>${esc(s.content || "")}</p>`;
  }
  return `<h2 class="s" id="${esc(s.id)}">${esc(s.title)}${conf}</h2>${body}`;
}

function renderDigestHtml(digest, source = {}) {
  const figures = Array.isArray(source.figures) ? source.figures : [];
  const base = source.baseUrl || "";
  const map = {};
  figures.forEach((f, i) => { const key = String(f.n != null ? f.n : i + 1); map[key] = f.src || f.dataA || ""; });
  const mapJson = JSON.stringify(map);
  const navLinks = (digest.sections || []).map(s => `<a class="block py-1" href="#${esc(s.id)}">${esc(s.title)}</a>`).join("");
  const sectionsHtml = (digest.sections || []).map(s => renderSection(s)).join("");
  const citations = (((digest.sections || []).find(s => s.id === "src") || {}).citations || []).map(c => `<p class="cite">${esc(c)}</p>`).join("");
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
    "{{CITATIONS}}": citations,
    "{{NAV_LINKS}}": navLinks,
    "{{BASE}}": esc(base),
    "{{MAP}}": mapJson,
  })) html = html.split(token).join(value);
  return html.replace("const MAP = {{MAP}};", `const MAP = {\n${mapJs}\n  };`);
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Digest: {{TITLE}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,400;7..72,600&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--paper:#F2F5F3;--ink:#16252C;--mute:#5B6C73;--rule:#CBD6D3;--teal:#0E6B73;--gain:#2B7A4B;--risk:#A83A2C;--warn:#9A6A12;--card:#FBFCFB}
body{background:var(--paper);color:var(--ink);font-family:Literata,Georgia,serif;line-height:1.65}
.ui{font-family:'Instrument Sans',system-ui,sans-serif}
h2.s{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:1.35rem;border-left:4px solid var(--teal);padding-left:.7rem;margin:2.6rem 0 .8rem}
p,li{max-width:72ch}
ul.b{list-style:disc;padding-left:1.2rem;margin:.4rem 0}
.conf{font-family:'Instrument Sans',system-ui,sans-serif;font-size:.75rem;font-weight:600;color:var(--teal);border:1px solid var(--teal);border-radius:999px;padding:.05rem .5rem;margin-left:.5rem;white-space:nowrap;vertical-align:middle}
.chip{font-family:'Instrument Sans',system-ui,sans-serif;font-size:.72rem;font-weight:600;border-radius:4px;padding:.05rem .4rem;margin-right:.4rem;color:#fff}
.neg{background:var(--risk)}.pos{background:var(--gain)}.neu{background:var(--warn)}
.item{border-bottom:1px solid var(--rule);padding:.7rem 0;max-width:72ch}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{border-bottom:1px solid var(--rule);padding:.45rem .5rem;text-align:left;vertical-align:top}
th{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;color:var(--mute)}
.wrap{overflow-x:auto}
blockquote{border-left:3px solid var(--rule);padding-left:1rem;color:var(--mute)}
code,.cite{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;color:var(--mute)}
figure{background:var(--card);border:1px solid var(--rule);padding:.6rem;width:100%;max-width:72ch}
figure img{display:block;width:100%;max-width:100%;height:auto;margin:0}
figcaption{font-size:.8rem;color:var(--mute);margin-top:.4rem}
main p,main li,main .item,main blockquote{text-align:justify;text-justify:inter-word;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:break-word}
main .cite,main .conf{text-align:left;hyphens:none}
main p{margin:.75rem 0}
main blockquote{margin:1.25rem 0}
main figure{margin:1.5rem 0}
#rd-hint{position:fixed;right:.8rem;bottom:.7rem;font:600 .7rem 'Instrument Sans',system-ui,sans-serif;color:var(--mute);background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:.2rem .55rem;opacity:.9;pointer-events:none}
</style>
</head>
<body class="antialiased">
<div class="mx-auto max-w-6xl px-5 py-10 lg:flex lg:gap-12">
<nav class="ui hidden lg:block w-44 shrink-0 text-sm sticky top-8 self-start" style="color:var(--mute)">
{{NAV_LINKS}}
</nav>
<main class="min-w-0 flex-1">
<header>
<p class="ui text-sm" style="color:var(--mute)">{{VENUE}} &middot; {{ID}} &middot; read: {{WHAT_READ}}</p>
<h1 class="ui text-3xl font-semibold leading-tight mt-1">{{TITLE}}</h1>
<p class="ui text-sm mt-1" style="color:var(--mute)">{{AUTHORS}}</p>
<p class="mt-4"><b>Verdict.</b> {{VERDICT}} <span class="conf">{{OVERALL_CONF}}%</span></p>
</header>

{{SECTIONS}}

{{CITATIONS}}
</main>
</div>
<script>const BASE="{{BASE}}";const MAP={{MAP}};</script>
`;

/**
 * Render a digest into an Obsidian container.
 * @param {import('obsidian').MetadataCache} dv - dataview API
 * @param {HTMLElement} container - obsidian container to render into
 * @param {string} digestPath - path to the digest JSON file
 */
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
  } catch (e) {
    container.empty();
    container.createEl("div", { text: `Failed to render ${digestPath}: ${e.message}`, cls: "pd-error" });
  }
};
