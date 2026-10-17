/**
 * OpenRouter LLM client, modeled on the reference Python `LLM` class.
 *
 * Reads the API key from `OPENROUTER_API_KEY` or `~/.paper_digest_key`,
 * calls https://openrouter.ai/api/v1/chat/completions, tries configured
 * models in order with retries and a per-run request cap.
 */

import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = "https://openrouter.ai/api/v1/key";
const KEY_FILE = join(homedir(), ".config/.paper_digest_key");

// Resolve the project config relative to this module's location (the package
// root) so `paper-digest digest` works no matter what the current working
// directory is. `process.cwd()` is kept as a fallback.
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(SELF_DIR, "..");

const DEFAULT_CFG = {
  models: [],
  model: undefined,
  temperature: 0.2,
  // One response must hold notes, draft, check and possibly final. Keep
  // the cap comfortably above a single digest's size (~2-3k tokens).
  max_tokens: 6144,
  retries: 2,
  max_requests_per_run: 50,
  timeout_s: 30,
};

export class LLMUnavailable extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LLMUnavailable";
  }
}

function loadKey() {
  const env = process.env.OPENROUTER_API_KEY;
  if (env) return env;
  if (existsSync(KEY_FILE)) {
    try {
      return readFileSync(KEY_FILE, "utf8").trim();
    } catch (_) {
      return "";
    }
  }
  return "";
}

function loadConfigFile() {
  for (const base of [PKG_ROOT, process.cwd()]) {
    const path = join(base, "paper-digest.config.json");
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (_) {
      return null;
    }
  }
  return null;
}

export function loadConfig(cfg = {}) {
  const merged = { ...DEFAULT_CFG, ...cfg };
  const fileCfg = loadConfigFile();
  if (fileCfg) Object.assign(merged, fileCfg);
  if (process.env.PAPER_DIGEST_MODEL) {
    merged.models = [process.env.PAPER_DIGEST_MODEL];
  }
  let models = merged.models || (merged.model ? [merged.model] : []);
  models = models.filter(Boolean);
  merged.models = models;
  return merged;
}

/**
 * Best-effort extraction of a JSON object from model output. Strips fenced
 * code blocks, fixes invalid backslash escape sequences (common when agents
 * emit LaTeX such as \hat or over-escaped \\\\(\\), removes trailing commas,
 * and, if needed, slices between the first `{` and last `}`. Sets
 * `_salvaged: true` when the raw text needed repair. Throws when no object can
 * be recovered so the caller can retry with a correction hint.
 */
export function extractJson(content) {
  let text = String(content).trim();
  let salvaged = false;
  const markSalvaged = () => { salvaged = true; };

  const fence =
    /```json\n([\s\S]*?)\n```/i.exec(text) || /```\n([\s\S]*?)\n```/i.exec(text);
  if (fence) {
    text = fence[1].trim();
    markSalvaged();
  }

  // JSON \f is form feed (U+000C), which breaks LaTeX \frac etc. Replace a
  // standalone \f (not preceded by backslash) with \\f so JSON.parse yields
  // \f (backslash + f) instead of a form feed character.
  const beforeFf = text.length;
  text = text.replace(/(?<!\\)\\f/g, "\\\\f");
  if (text.length !== beforeFf) markSalvaged();

  // Fix invalid backslash escape sequences. JSON only allows \" \\ \/ \b \f
  // \n \r \t \uXXXX after a backslash. Agents often emit LaTeX like \hat,
  // \mathrm, \(...\) with a single or wrong number of backslashes, and may
  // write \\" inside a string when they mean a literal quote. Walk the text
  // left to right: valid escape sequences are preserved verbatim; an invalid
  // \X is re-encoded as \\X; and \\" followed by content (not a string
  // terminator) is re-encoded as \\\" so the quote stays inside the string.
  const VALID_ESCAPES = '"\\/bfnrtu';
  const STRUCTURAL = ":,}]\"\t\n\r ";
  let fixed = "";
  let i = 0;
  let changed = false;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (VALID_ESCAPES.includes(next)) {
        if (next === "\\" && i + 2 < text.length && text[i + 2] === '"') {
          // Skip whitespace to decide if the quote is content or a terminator.
          let j = i + 3;
          while (j < text.length && " \t\n\r".includes(text[j])) j += 1;
          const afterWs = text[j];
          const isContent =
            afterWs !== undefined && !":,}]\"".includes(afterWs);
          if (isContent) {
            // \\" -> \\\" so the quote stays inside the string
            fixed += '\\\\\\"';
            i += 3;
            changed = true;
            continue;
          }
        }
        fixed += "\\" + next;
        i += 2;
      } else {
        fixed += "\\\\" + next;
        i += 2;
        changed = true;
      }
    } else {
      fixed += text[i];
      i += 1;
    }
  }
  if (changed) {
    text = fixed;
    markSalvaged();
  }

  // Salvage unescaped double quotes inside string values — a common LLM slip
  // (e.g. writing ""title" author" instead of \"title\" author). Walk the
  // text tracking string state; an unescaped quote inside a string that is
  // followed by a non-structural character is content, not a terminator.
  let unescapedFixed = "";
  let inString = false;
  let uChanged = false;
  let u = 0;
  while (u < text.length) {
    const c = text[u];
    if (inString) {
      if (c === "\\") {
        unescapedFixed += c;
        if (u + 1 < text.length) unescapedFixed += text[u + 1];
        u += 2;
        continue;
      }
      if (c === '"') {
        let j = u + 1;
        while (j < text.length && " \t\n\r".includes(text[j])) j += 1;
        const after = text[j];
        const isTerminator =
          after === undefined || ",}]".includes(after) || after === ":";
        if (isTerminator) {
          unescapedFixed += c;
          inString = false;
        } else {
          unescapedFixed += '\\"';
          uChanged = true;
        }
        u += 1;
        continue;
      }
      unescapedFixed += c;
      u += 1;
    } else {
      unescapedFixed += c;
      if (c === '"') inString = true;
      u += 1;
    }
  }
  if (uChanged) {
    text = unescapedFixed;
    markSalvaged();
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    markSalvaged();
    // Remove trailing commas before } or ] — a common LLM slip.
    const commaFixed = text.replace(/,\s*([}\]])/g, "$1");
    try {
      parsed = JSON.parse(commaFixed);
    } catch (__) {
      // Slice between the first { and last } to drop surrounding prose.
      const first = commaFixed.indexOf("{");
      const last = commaFixed.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        try {
          parsed = JSON.parse(commaFixed.slice(first, last + 1));
        } catch (___ ) {
          parsed = null;
        }
      }
    }
  }
  if (!parsed) {
    throw new Error("no parseable JSON object in response");
  }

  // JSON \f is form feed (U+000C), which breaks LaTeX \frac etc. Walk the
  // parsed object and replace any form feed chars in string values with f
  // (the preceding backslash, if any, is already present from \\ in the
  // JSON source).
  const FF = "\f";
  function fixFormFeeds(obj) {
    if (typeof obj === "string") {
      if (obj.includes(FF)) {
        salvaged = true;
        return obj.split(FF).join("f");
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(fixFormFeeds);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = fixFormFeeds(v);
      return out;
    }
    return obj;
  }
  parsed = fixFormFeeds(parsed);

  return { _salvaged: salvaged, ...parsed };
}

/**
 * Extract a Markdown document with YAML frontmatter from model output.
 *
 * Strips markdown fences, parses the frontmatter block (--- ... ---) into
 * metadata, and returns the body text. Sets _salvaged: true when the raw text
 * needed repair. Throws when no frontmatter can be found.
 */
export function extractMarkdown(content) {
  // Normalize CRLF to LF so frontmatter parsing works regardless of platform.
  let text = String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  let salvaged = false;
  const markSalvaged = () => { salvaged = true; };

  const fence =
    /```markdown\n([\s\S]*?)\n```/i.exec(text) ||
    /```\n([\s\S]*?)\n```/i.exec(text);
  if (fence) {
    text = fence[1].trim();
    markSalvaged();
  }

  // Parse YAML frontmatter: --- ... ---
  const fmRe = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  let m = fmRe.exec(text);

  if (!m && text.startsWith("---\n")) {
    // Frontmatter opened with --- but never closed. Salvage by treating
    // everything up to the first real section header as frontmatter, then the
    // rest as body. Corrupted frontmatter fields that the agent wrote as
    // markdown headers (e.g. "## title: ...") are demoted back to fields.
    const sectionTitles = new Set([
      "motivation",
      "core idea",
      "distinguishing factor",
      "evaluation and conclusions",
      "in case you missed it",
      "cautious judgement",
      "sources and limits",
    ]);
    const rest = text.slice(4); // drop the leading "---\n"
    const lines = rest.split("\n");
    let splitIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const hm = /^##\s+(.+)$/.exec(lines[i]);
      if (!hm) continue;
      const t = hm[1]
        .trim()
        .replace(/\s*\([^)]*confidence[^)]*\)\s*$/i, "")
        .trim()
        .toLowerCase();
      if (sectionTitles.has(t)) {
        splitIdx = i;
        break;
      }
    }
    const fmLines = lines.slice(0, splitIdx).map((l) => l.replace(/^##\s+/, ""));
    m = [text, fmLines.join("\n"), lines.slice(splitIdx).join("\n")];
    markSalvaged();
  }

  if (!m) {
    throw new Error("no parseable Markdown frontmatter in response");
  }

  const fmText = m[1];
  const body = m[2];
  const metadata = {};
  for (const line of fmText.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (!key) continue;
    // Try JSON.parse for values that look like JSON (arrays/objects).
    if ((val.startsWith("[") || val.startsWith("{")) && (val.endsWith("]") || val.endsWith("}"))) {
      try { val = JSON.parse(val); } catch (_) { /* keep as string */ }
    } else if (key === "authors" && val.includes(",")) {
      // Only authors is a list. All other scalar fields (verdict, whatRead,
      // ...) round-trip verbatim so commas inside prose keep their spaces.
      val = val.split(",").map((s) => s.trim()).filter(Boolean);
    }
    metadata[key] = val;
  }

  return { _salvaged: salvaged, metadata, body, raw: text };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LLM {
  constructor(cfg) {
    this.cfg = loadConfig(cfg);
    this.requests = 0;
    this.models = [];
    this.key = loadKey();
    if (!this.key) {
      throw new LLMUnavailable(
        `no API key (env OPENROUTER_API_KEY or ${KEY_FILE})`
      );
    }
  }

  async _http(url, body, timeout = 30) {
    const data = body !== null ? JSON.stringify(body) : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);
    try {
      const resp = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "X-Title": "paper-digest",
        },
        body: data,
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        const err = new Error(`HTTP ${resp.status}`);
        err.name = "HTTPError";
        err.code = resp.status;
        err.detail = text;
        err.headers = resp.headers;
        throw err;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = {};
      }
      return [parsed, resp];
    } finally {
      clearTimeout(timer);
    }
  }

  async remainingDaily() {
    try {
      const [d] = await this._http(OPENROUTER_KEY, null, 30);
      return d?.data?.free_model_daily_requests?.remaining ?? null;
    } catch (e) {
      console.warn(
        `[paper-digest] could not read free-request quota (${
          e.constructor.name
        }); continuing`
      );
      return null;
    }
  }

  async chat(system, user) {
    const c = this.cfg;
    const warn = (msg) => console.warn(`[paper-digest] ${msg}`);
    let models = c.models;
    if (!models || !models.length) {
      if (c.model) models = [c.model];
      else throw new LLMUnavailable("no models configured");
    }
    let last = "unknown";

    for (const model of models) {
      const body = {
        model,
        temperature: c.temperature,
        max_tokens: c.max_tokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      for (let attempt = 0; attempt <= c.retries; attempt++) {
        if (this.requests >= c.max_requests_per_run) {
          throw new LLMUnavailable(`per-run request cap reached (${last})`);
        }
        this.requests += 1;
        try {
          const [resp] = await this._http(
            OPENROUTER_CHAT,
            body,
            c.timeout_s
          );
          const choices = resp.choices || [];
          if (!choices.length) {
            throw new Error(
              `response has no choices (response_id=${
                resp.id ?? "?"
              }, model=${resp.model ?? model}, keys=${Object.keys(resp)
                .sort()
                .join(", ")})`
            );
          }
          const choice = choices[0];
          const message = choice.message || {};
          let content = (message.content || "").trim();
          if (!content) {
            throw new Error(
              `empty content (response_id=${resp.id ?? "?"}, model=${
                resp.model ?? model
              }, finish_reason=${choice.finish_reason ?? null}, refusal=${
                message.refusal ?? null
              }, usage=${JSON.stringify(resp.usage ?? null)})`
            );
          }
          this.models.push(resp.model ?? model);
          return content;
        } catch (e) {
          if (e instanceof LLMUnavailable) throw e;
          if (e.name === "HTTPError") {
            const detail = String(e.detail ?? "")
              .slice(0, 500)
              .trim();
            last = `HTTP ${e.code}` + (detail ? `: ${detail}` : "");
            warn(
              `model ${model} attempt ${attempt + 1}/${c.retries + 1} failed: ${last}`
            );
            if (e.code === 401) {
              throw new LLMUnavailable(last, { cause: e });
            }
            if ([400, 402, 403, 404].includes(e.code)) {
              break; // this model is unusable; try the next
            }
            const wait =
              e.code === 429
                ? parseInt(e.headers?.get("Retry-After") ?? "0", 10) || 0
                : 0;
            await sleep(Math.min(Math.max(wait, 5), 30) || 3);
            continue;
          }
          last = `${e.constructor.name}: ${e.message}`;
          warn(
            `model ${model} attempt ${attempt + 1}/${c.retries + 1} failed: ${last}`
          );
          await sleep(3);
        }
      }
    }
    throw new LLMUnavailable(`all configured models failed (${last})`);
  }
}
