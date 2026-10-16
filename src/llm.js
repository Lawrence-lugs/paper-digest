/**
 * OpenRouter LLM client, modeled on the reference Python `LLM` class.
 *
 * Reads the API key from `OPENROUTER_API_KEY` or `~/.paper_digest_key`,
 * calls https://openrouter.ai/api/v1/chat/completions, tries configured
 * models in order with retries and a per-run request cap.
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const OPENROUTER_CHAT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = "https://openrouter.ai/api/v1/key";
const KEY_FILE = join(homedir(), ".paper_digest_key");

const DEFAULT_CFG = {
  models: [],
  model: undefined,
  temperature: 0.2,
  max_tokens: 2048,
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
  const path = join(process.cwd(), "paper-digest.config.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (_) {
    return null;
  }
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
        response_format: { type: "json_object" },
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
          let parsed;
          try {
            parsed = extractJson(content);
          } catch (e) {
            throw new Error(`invalid JSON: ${e.message}`);
          }
          if (parsed._salvaged) {
            warn(
              `model ${resp.model ?? model} returned malformed JSON; recovered`
            );
          }
          this.models.push(resp.model ?? model);
          delete parsed._salvaged;
          return parsed;
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
          body.messages[body.messages.length - 1].content =
            user +
            "\n\nIMPORTANT: your previous reply was not valid JSON. Reply with ONE valid JSON object only, no prose. Keep each blurb to two short sentences.";
          await sleep(3);
        }
      }
    }
    throw new LLMUnavailable(`all configured models failed (${last})`);
  }
}
