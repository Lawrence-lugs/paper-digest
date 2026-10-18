/**
 * Agent B — LLM clients.
 *
 * `LLMClient` interface: one method, `chat(system, user) -> Promise<string>`.
 * Implementations:
 *  - OpenRouterClient   : direct OpenRouter from the browser (API key in memory)
 *  - OpenAICompatibleClient : any OpenAI-compatible base URL (e.g. local Ollama)
 *  - LocalBackendClient : optional app backend URL
 *
 * Default timeout is 180 s (was 30 s in the CLI); a 6 k-token completion from
 * a free model will not finish in 30 s. Timeout is a setting.
 */

export class LLMUnavailable extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LLMUnavailable";
    this.fatal = true;
  }
}

export class HTTPError extends Error {
  constructor(message, { status, detail, headers } = {}) {
    super(message);
    this.name = "HTTPError";
    this.status = status;
    this.detail = detail;
    this.headers = headers;
    // 401/400/402/403/404 mean this model is unusable (fatal for the model,
    // not for the whole run); 429 and 5xx are retryable.
    this.fatal = status === 401 || [400, 402, 403, 404].includes(status);
    this.retryable = status === 429 || (status >= 500 && status < 600);
  }
}

export class LLMClient {
  constructor(cfg = {}) {
    this.timeoutS = cfg.timeoutS ?? 180;
    this.retries = cfg.retries ?? 2;
  }
  async chat(system, user) {
    throw new Error("NotImplemented: LLMClient.chat");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, retryAfter) {
  if (retryAfter) return Math.min(Math.max(retryAfter, 0), 30) * 1000 || 3000;
  return Math.min(Math.pow(2, attempt) * 1000, 30000);
}

/** POST JSON, return the parsed body or throw HTTPError. */
async function postJson(url, body, timeoutS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new HTTPError(`HTTP ${resp.status}`, {
        status: resp.status,
        detail: text.slice(0, 500),
        headers: resp.headers,
      });
    }
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (_) { /* keep {} */ }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each model in order, retrying each. Returns the assistant message
 * content string. Throws LLMUnavailable when all models fail.
 */
async function tryModels(models, request, { timeoutS, retries }) {
  let last = "unknown";
  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await request(model, timeoutS);
      } catch (e) {
        last = e;
        if (e instanceof LLMUnavailable) throw e;
        if (e instanceof HTTPError && e.fatal) {
          // model unusable; try the next
          break;
        }
        await sleep(backoffMs(attempt, e.retryAfter ? e.headers?.get("Retry-After") : null));
      }
    }
  }
  throw new LLMUnavailable(`all configured models failed (${last && last.message ? last.message : last})`);
}

export class OpenRouterClient extends LLMClient {
  constructor(cfg = {}) {
    super(cfg);
    this.apiKey = cfg.apiKey || null; // memory-only by default
    this.models = Array.isArray(cfg.models) ? cfg.models : [];
    this.temperature = cfg.temperature ?? 0.2;
    this.maxTokens = cfg.maxTokens ?? 6144;
  }

  async chat(system, user) {
    if (!this.apiKey) throw new LLMUnavailable("no OpenRouter API key");
    if (!this.models.length) throw new LLMUnavailable("no OpenRouter models configured");
    const baseBody = {
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    return tryModels(this.models, (model) => this.postModel(model, baseBody), {
      timeoutS: this.timeoutS,
      retries: this.retries,
    });
  }

  async postModel(model, baseBody) {
    const body = { ...baseBody, model };
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "paper-digest",
    };
    const resp = await postJsonWithHeaders(
      "https://openrouter.ai/api/v1/chat/completions",
      body,
      headers,
      this.timeoutS,
    );
    const choices = resp.choices || [];
    if (!choices.length) {
      throw new Error(`response has no choices (model=${model})`);
    }
    const content = String((choices[0].message || {}).content || "").trim();
    if (!content) {
      throw new Error(`empty content (model=${model}, finish_reason=${choices[0].finish_reason ?? null})`);
    }
    return content;
  }
}

export class OpenAICompatibleClient extends LLMClient {
  constructor(cfg = {}) {
    super(cfg);
    this.baseUrl = cfg.baseUrl || "";
    this.apiKey = cfg.apiKey || null;
    this.models = Array.isArray(cfg.models) ? cfg.models : [cfg.model].filter(Boolean);
    this.temperature = cfg.temperature ?? 0.2;
    this.maxTokens = cfg.maxTokens ?? 6144;
  }

  async chat(system, user) {
    if (!this.baseUrl) throw new LLMUnavailable("no base URL configured");
    if (!this.models.length) throw new LLMUnavailable("no models configured");
    const baseBody = {
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    return tryModels(this.models, (model) => this.postModel(model, baseBody), {
      timeoutS: this.timeoutS,
      retries: this.retries,
    });
  }

  async postModel(model, baseBody) {
    const body = { ...baseBody, model };
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const url = this.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const resp = await postJsonWithHeaders(url, body, headers, this.timeoutS);
    const choices = resp.choices || [];
    if (!choices.length) throw new Error(`response has no choices (model=${model})`);
    const content = String((choices[0].message || {}).content || "").trim();
    if (!content) throw new Error(`empty content (model=${model})`);
    return content;
  }
}

export class LocalBackendClient extends LLMClient {
  constructor(cfg = {}) {
    super(cfg);
    this.baseUrl = cfg.baseUrl || "";
  }

  async chat(system, user) {
    if (!this.baseUrl) throw new LLMUnavailable("no local backend URL configured");
    const body = { system, user };
    const resp = await postJsonWithHeaders(
      this.baseUrl.replace(/\/$/, "") + "/digest",
      body,
      { "Content-Type": "application/json" },
      this.timeoutS,
    );
    const content = String(resp.content || resp.text || resp.digest || "").trim();
    if (!content) throw new Error("local backend returned no digest text");
    return content;
  }
}

async function postJsonWithHeaders(url, body, headers, timeoutS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutS * 1000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new HTTPError(`HTTP ${resp.status}`, {
        status: resp.status,
        detail: text.slice(0, 500),
        headers: resp.headers,
      });
    }
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (_) { /* keep {} */ }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
