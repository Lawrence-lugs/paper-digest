/**
 * Agent C — app shell entry.
 *
 * Three modes:
 *  - digest   : ingest a source, run the LLM digest, open/save/copy result.
 *  - prompt   : ingest a source, show the master prompt (no LLM), copy it.
 *  - template : paste an AI digest response, render it (figures from the
 *    session store), open/save/copy result.
 *
 * The source panel is always visible; mode tabs switch the controls below.
 * API key is memory-only by default; "Remember on this device" is opt-in.
 */

import { ingest, FetchBlockedError } from "../ingest/ingest.js";
import {
  buildPrompt,
  runDigest,
  parseDigest,
  filenameFor,
  openInTab,
  downloadHtml,
  copyHtml,
} from "../pipeline/pipeline.js";
import { renderDigest } from "../pipeline/render.js";
import {
  OpenRouterClient,
  OpenAICompatibleClient,
  LocalBackendClient,
  LLMUnavailable,
} from "../pipeline/llm.js";
import { sessions, sessionKey } from "../store/sessions.js";

/* ---------------------------------------------------------------- state */

let mode = "digest"; // digest | prompt | template
let currentSource = null;
let currentKey = null;
let digestResult = null;
let settings = {
  provider: "openrouter",
  apiKey: "",
  remember: false,
  models: "meta-llama/llama-3.2-3b-instruct",
  baseUrl: "http://localhost:11434/v1",
  timeoutS: 180,
};

const ELS = {};
function bind() {
  const ids = [
    "mode-digest","mode-prompt","mode-template","btnSettings","btnBack",
    "view-digest","view-prompt","view-template","view-settings","view-result",
    "inputUrl","inputPaste","inputBaseUrl","fileUpload","btnIngest","ingestError","ingestedCard",
    "digestControls","promptControls",
    "inputResponse","btnPasteResponse","btnAttach",
    "resultCard","resultMeta","resultFigures","btnOpenTab","btnDownload","btnCopy","openFallback",
    "keyInput","remember","providerSelect","modelsInput","baseUrlInput","timeoutInput",
    "recentList","noRecent","providerFields",
  ];
  for (const id of ids) ELS[id] = document.getElementById(id);
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setStatus(t) {
  const el = ELS.status || document.getElementById("status");
  if (el) el.textContent = t;
}

/* ---------------------------------------------------------------- settings */

export function loadSettings() {
  try {
    const raw = localStorage.getItem("paper-digest-settings");
    if (raw) {
      const p = JSON.parse(raw);
      settings.provider = p.provider || settings.provider;
      settings.models = p.models || settings.models;
      settings.baseUrl = p.baseUrl || settings.baseUrl;
      settings.timeoutS = p.timeoutS || settings.timeoutS;
      settings.remember = !!p.remember;
    }
  } catch (_) { /* ignore */ }
  // Key: memory-only unless "remember" was set previously.
  try {
    if (settings.remember) {
      settings.apiKey = localStorage.getItem("paper-digest-key") || "";
    }
  } catch (_) { /* ignore */ }
  applySettingsUI();
}

function applySettingsUI() {
  ELS.keyInput.value = settings.apiKey ? "••••••••" : "";
  ELS.remember.checked = settings.remember;
  ELS.providerSelect.value = settings.provider;
  ELS.modelsInput.value = settings.models;
  ELS.baseUrlInput.value = settings.baseUrl;
  ELS.timeoutInput.value = settings.timeoutS;
  toggleProviderFields();
}

export function saveSettings() {
  settings.provider = ELS.providerSelect.value;
  settings.models = ELS.modelsInput.value.trim();
  settings.baseUrl = ELS.baseUrlInput.value.trim();
  settings.timeoutS = Number(ELS.timeoutInput.value) || 180;
  settings.remember = ELS.remember.checked;
  const raw = ELS.keyInput.value;
  if (raw && raw !== "••••••••") settings.apiKey = raw;
  try {
    localStorage.setItem("paper-digest-settings", JSON.stringify(settings));
    if (settings.remember && settings.apiKey) {
      localStorage.setItem("paper-digest-key", settings.apiKey);
    } else if (!settings.remember) {
      localStorage.removeItem("paper-digest-key");
    }
  } catch (_) { /* ignore */ }
  toggleProviderFields();
}

function toggleProviderFields() {
  const showModels = settings.provider === "openrouter" || settings.provider === "openai";
  const showBase = settings.provider === "openai" || settings.provider === "local";
  ELS.modelsInput.parentElement.style.display = showModels ? "block" : "none";
  ELS.baseUrlInput.parentElement.style.display = showBase ? "block" : "none";
}

function createClient() {
  const models = settings.models.split(",").map((m) => m.trim()).filter(Boolean);
  const common = { timeoutS: settings.timeoutS };
  switch (settings.provider) {
    case "openrouter":
      return new OpenRouterClient({ ...common, apiKey: settings.apiKey, models });
    case "openai":
      return new OpenAICompatibleClient({ ...common, apiKey: settings.apiKey, baseUrl: settings.baseUrl, models });
    case "local":
      return new LocalBackendClient({ ...common, baseUrl: settings.baseUrl });
    default:
      return new OpenRouterClient({ ...common, apiKey: settings.apiKey, models });
  }
}

/* ---------------------------------------------------------------- ingest */

function clearIngestError() {
  ELS.ingestError.classList.add("hidden");
  ELS.ingestError.innerHTML = "";
}

function showIngestError(e) {
  ELS.ingestError.innerHTML = `
    <div class="err">
      Could not fetch <b>${escHtml(e.url)}</b> (${escHtml(e.reason)}).
      This is usually CORS or the site blocking automated fetching.
      <br><br>Open the paper in your browser, save the page (or copy outerHTML
      from devtools), then upload or paste it here. The Base URL field helps
      resolve relative figure URLs.
    </div>`;
  ELS.ingestError.classList.remove("hidden");
}

function showError(msg, container) {
  const box = document.createElement("div");
  box.className = "err";
  box.textContent = msg;
  (container || ELS.ingestError.parentElement).insertAdjacentElement("afterend", box);
  setTimeout(() => box.remove(), 5000);
}

async function doIngest(kind, value) {
  setStatus("Ingesting source…");
  clearIngestError();
  try {
    const source = await ingest({
      kind,
      value,
      baseUrl: ELS.inputBaseUrl.value.trim() || undefined,
    });
    currentSource = source;
    currentKey = source.key;
    await sessions.put({
      key: source.key, site: source.site, ids: source.ids, title: source.title,
      sourceUrl: source.sourceUrl, baseUrl: source.baseUrl, figures: source.figures,
      createdAt: Date.now(),
    });
    renderIngestedCard(source);
    refreshRecent();
    setStatus(`Ingested ${escHtml(source.title)} (${source.figures.length} figure${source.figures.length===1?"":"s"})`);
    return source;
  } catch (e) {
    if (e instanceof FetchBlockedError) {
      showIngestError(e);
    } else {
      showError(e.message || String(e));
    }
    throw e;
  }
}

function renderIngestedCard(source) {
  const s = source;
  ELS.ingestedCard.innerHTML = `
    <div class="meta">
      <b>${escHtml(s.title)}</b> · ${escHtml(s.site)} ·
      ${escHtml(s.venue || "venue unknown")}
      ${s.sourceUrl ? `· <a href="${escHtml(s.sourceUrl)}" target="_blank" rel="noopener">source</a>` : ""}
    </div>
    <div class="small">${escHtml(s.whatRead)} · ${s.figures.length} figure${s.figures.length===1?"":"s"} detected · key: ${escHtml(s.key)}</div>
    ${s.warnings.length ? `<div class="warn small">${s.warnings.map((w)=>escHtml(w)).join(" · ")}</div>` : ""}`;
}

function wireIngest() {
  ELS.btnIngest.onclick = async () => {
    const url = ELS.inputUrl.value.trim();
    const paste = ELS.inputPaste.value.trim();
    const file = ELS.fileUpload.files[0];
    if (url) await doIngest("url", url);
    else if (paste) await doIngest("html", paste);
    else if (file) await doIngest("file", file);
    else setStatus("Provide a URL, paste HTML, or upload a file.");
  };
}

/* ---------------------------------------------------------------- digest mode */

function renderDigestControls() {
  ELS.digestControls.innerHTML = `
    <div class="section tight">
      <h2>2. Digest</h2>
      <p class="small hint">Run the LLM digest (needs an API key) to produce the digest HTML page.</p>
      <button id="btnRun" class="primary">Run digest</button>
    </div>`;
  ELS.btnRun = document.getElementById("btnRun");
  ELS.btnRun.onclick = runDigestFlow;
}

async function runDigestFlow() {
  if (!currentSource) return setStatus("Ingest a source first.");
  try {
    setStatus("Running digest… (free models can take a minute)");
    const client = createClient();
    const { digest, raw } = await runDigest(currentSource, client, { timeoutS: settings.timeoutS });
    const html = await renderDigest(digest, { figures: currentSource.figures, baseUrl: currentSource.baseUrl });
    digestResult = { digest, html };
    await sessions.put({
      key: currentSource.key, site: currentSource.site, ids: currentSource.ids,
      title: digest.meta.title || currentSource.title,
      sourceUrl: currentSource.sourceUrl, baseUrl: currentSource.baseUrl,
      figures: currentSource.figures, createdAt: Date.now(),
    });
    refreshRecent();
    renderResultCard();
    showView("view-result");
  } catch (e) {
    if (e instanceof LLMUnavailable) {
      showError("LLM unavailable: " + e.message + "\nCheck your API key, models, or base URL in Settings.", ELS.digestControls);
    } else {
      showError(e.message || String(e), ELS.digestControls);
    }
    setStatus("Digest failed.");
  }
}

/* ---------------------------------------------------------------- prompt mode */

function renderPromptControls(source) {
  ELS.promptControls.innerHTML = `
    <div class="section tight">
      <h2>2. Prompt</h2>
      <p class="small hint">Copy the master prompt and send it to any chat AI.</p>
      <button id="btnCopyPrompt" class="primary">Copy prompt</button>
      <div id="promptBox" class="preview-box hidden" style="margin-top:0.5rem;"></div>
    </div>`;
  const btn = document.getElementById("btnCopyPrompt");
  const box = document.getElementById("promptBox");
  btn.onclick = async () => {
    const p = buildPrompt(currentSource);
    box.textContent = p;
    box.classList.remove("hidden");
    try { await navigator.clipboard.writeText(p); setStatus("Prompt copied."); } catch (_) { setStatus("Copy failed; select the text manually."); }
  };
}

/* ---------------------------------------------------------------- template mode */

function renderTemplateControls() {
  // HTML is static in index.html; just wire buttons.
  ELS.btnPasteResponse.onclick = async () => {
    const text = ELS.inputResponse.value.trim();
    if (!text) return setStatus("Paste an AI response first.");
    try {
      setStatus("Parsing AI response…");
      const digest = parseDigest(text);
      const source = currentSource || await resolveSourceFromDigest(digest);
      if (!source) {
        ELS.inputResponse.insertAdjacentElement("afterend",
          `<div class="err">No source attached and no matching saved session. Ingest a source in Digest mode, then paste again.</div>`);
        return;
      }
      currentSource = source;
      const html = await renderDigest(digest, { figures: source.figures, baseUrl: source.baseUrl });
      digestResult = { digest, html };
      currentKey = source.key;
      await sessions.put({
        key: source.key, site: source.site, ids: source.ids, title: digest.meta.title || source.title,
        sourceUrl: source.sourceUrl, baseUrl: source.baseUrl, figures: source.figures, createdAt: Date.now(),
      });
      refreshRecent();
      renderResultCard();
      showView("view-result");
    } catch (e) {
      showError(e.message || String(e));
      setStatus("Render failed.");
    }
  };
  ELS.btnAttach.onclick = () => { showView("view-digest"); };
}

export async function resolveSourceFromDigest(digest) {
  if (currentSource) return currentSource;
  const found = await sessions.findByDigest(digest);
  if (found) {
    return {
      site: found.site || "unknown", ids: found.ids || {}, key: found.key,
      title: found.title || "Untitled", authors: [], venue: "",
      sourceUrl: found.sourceUrl || null, baseUrl: found.baseUrl || null,
      whatRead: "", paperText: "", figures: found.figures || [], warnings: [],
    };
  }
  return null;
}

/* ---------------------------------------------------------------- result view */

function renderResultCard() {
  const card = ELS.resultCard;
  const meta = ELS.resultMeta;
  const figures = ELS.resultFigures;
  card.classList.add("hidden");
  if (!digestResult) { meta.innerHTML = ""; figures.innerHTML = ""; return; }
  const { digest } = digestResult;
  const m = digest.meta || {};
  const figCount = (currentSource && currentSource.figures.length) || 0;
  meta.innerHTML = `
    <div class="meta">
      <b>${escHtml(m.title || "Untitled")}</b> ·
      ${escHtml(m.venue || "")} · ${escHtml(m.id || "")} ·
      read: ${escHtml(m.whatRead || "")}
    </div>
    <p><b>Verdict.</b> ${escHtml(m.verdict || "")} <span style="color:#2b7a4b;">(${escHtml(m.overallConfidence || 0)}%)</span></p>
    <p class="small">${figCount} figure${figCount===1?"":"s"} in source. Output opens in a new tab.</p>`;
  figures.innerHTML = "";
  card.classList.remove("hidden");
}

function wireResultActions() {
  ELS.btnOpenTab.onclick = (e) => {
    e.preventDefault();
    if (!digestResult) return;
    const res = openInTab(digestResult.html);
    if (res.blocked) {
      ELS.openFallback.classList.remove("hidden");
    } else {
      setStatus("Digest opened in a new tab.");
    }
  };
  ELS.btnDownload.onclick = (e) => {
    e.preventDefault();
    if (!digestResult) return;
    const name = filenameFor(digestResult.digest) + ".html";
    downloadHtml(digestResult.html, name);
    setStatus("Downloaded " + name);
  };
  ELS.btnCopy.onclick = async (e) => {
    e.preventDefault();
    if (!digestResult) return;
    try { await copyHtml(digestResult.html); setStatus("HTML copied to clipboard."); } catch (e) { showError(e.message || String(e)); }
  };
}

/* ---------------------------------------------------------------- recent sessions */

export async function refreshRecent() {
  const list = ELS.recentList;
  const none = ELS.noRecent;
  try {
    const items = await sessions.list();
    if (!items.length) { list.classList.add("hidden"); none.classList.remove("hidden"); return; }
    none.classList.add("hidden"); list.classList.remove("hidden");
    list.innerHTML = "";
    for (const s of items.slice(0, 10)) {
      const li = document.createElement("li");
      li.innerHTML = `<div style="font-weight:600;">${escHtml(s.title || "Untitled")}</div>
        <div class="key">${escHtml(s.key)} · ${escHtml(s.site || "")}</div>
        <div style="display:flex;gap:0.3rem;margin-top:0.3rem;">
          <button class="open-recent" data-key="${escHtml(s.key)}">Open</button>
          <button class="dl-recent" data-key="${escHtml(s.key)}">Download</button>
        </div>`;
      list.appendChild(li);
    }
    list.querySelectorAll(".open-recent").forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        const s = await sessions.get(b.dataset.key);
        if (!s) return setStatus("Session not found.");
        currentSource = {
          site: s.site || "unknown", ids: s.ids || {}, key: s.key, title: s.title,
          authors: [], venue: "", sourceUrl: s.sourceUrl || null, baseUrl: s.baseUrl || null,
          whatRead: "", paperText: "", figures: s.figures || [], warnings: [],
        };
        currentKey = s.key;
        setStatus("Session loaded: " + escHtml(s.title));
        renderIngestedCard(currentSource);
        showView("view-digest");
      };
    });
    list.querySelectorAll(".dl-recent").forEach((b) => {
      b.onclick = async (e) => {
        e.preventDefault();
        const s = await sessions.get(b.dataset.key);
        if (!s) return setStatus("Session not found.");
        const digest = { meta: { title: s.title || "Untitled", authors: [], venue: s.site || "", id: "", whatRead: "", verdict: "", overallConfidence: 0 }, sections: [] };
        const html = await renderDigest(digest, { figures: s.figures || [], baseUrl: s.baseUrl || null });
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = (filenameFor(digest) || "digest") + ".html";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus("Downloaded " + escHtml(s.title));
      };
    });
  } catch (_) {
    list.classList.add("hidden"); none.classList.remove("hidden");
  }
}

/* ---------------------------------------------------------------- router */

function showView(name) {
  for (const v of ["view-digest","view-prompt","view-template","view-settings","view-result"]) {
    ELS[v].classList.add("hidden");
  }
  ELS[name].classList.remove("hidden");
  for (const m of ["mode-digest","mode-prompt","mode-template"]) {
    ELS[m].classList.toggle("active", m === `mode-${name.replace("view-","")}`);
  }
  mode = name.replace("view-", "");
}

async function init() {
  bind();
  loadSettings();
  // CSR parsers are loaded via classic <script> tags; verify availability.
  if (!window.CSR || !window.CSR.findParsedArticle) {
    setStatus("Warning: CSR parsers not loaded.");
  }

  // Mode tabs (bind() keys the elements by their HTML id attribute)
  ELS["mode-digest"].onclick = () => { showView("view-digest"); };
  ELS["mode-prompt"].onclick = () => { showView("view-prompt"); };
  ELS["mode-template"].onclick = () => { showView("view-template"); };
  ELS.btnSettings.onclick = () => { saveSettings(); showView("view-settings"); };
  ELS.btnBack.onclick = () => { saveSettings(); showView("view-digest"); };

  // Settings live updates
  ELS.keyInput.oninput = () => { const raw = ELS.keyInput.value; if (raw && raw !== "••••••••") settings.apiKey = raw; };
  ELS.remember.onchange = saveSettings;
  ELS.providerSelect.onchange = () => { settings.provider = ELS.providerSelect.value; toggleProviderFields(); saveSettings(); };
  ELS.modelsInput.oninput = () => { settings.models = ELS.modelsInput.value; saveSettings(); };
  ELS.baseUrlInput.oninput = () => { settings.baseUrl = ELS.baseUrlInput.value; saveSettings(); };
  ELS.timeoutInput.oninput = () => { settings.timeoutS = Number(ELS.timeoutInput.value) || 180; saveSettings(); };

  wireIngest();
  renderDigestControls();
  renderPromptControls();
  renderTemplateControls();
  wireResultActions();

  refreshRecent();
  showView("view-digest");
  setStatus("Ready");
}

init().catch((e) => { console.error(e); setStatus("Startup error: " + (e.message || String(e))); });
