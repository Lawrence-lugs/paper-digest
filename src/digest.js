/**
 * Agent orchestration: build the master prompt, call the OpenRouter LLM,
 * return the parsed digest JSON.
 *
 * The LLM client (src/llm.js) follows the reference Python `LLM` class:
 * OpenRouter API key from OPENROUTER_API_KEY or ~/.paper_digest_key,
 * models tried in order with retries and a per-run cap.
 */

import { buildMasterPrompt } from "./prompt.js";
import { LLM, loadConfig } from "./llm.js";

const SYSTEM = "You are a careful, skeptical research-paper reader. Output only valid JSON.";

export { loadConfig };

/**
 * Build a pre-configured OpenRouter LLM client.
 *
 * @param {object} [cfg] - LLM config (models, temperature, max_tokens, ...)
 * @returns {LLM}
 */
export function createClient(cfg) {
  return new LLM(cfg);
}

/**
 * Run the agent on a resolved source. Returns the parsed digest object.
 *
 * @param {object} source - output of fetch.resolve()
 * @param {object} [opts]
 * @param {LLM} [opts.client] - pre-built LLM client
 * @param {object} [opts.cfg] - LLM config (passed to LLM constructor)
 * @returns {Promise<object>}
 */
export async function digestSource(source, { client, cfg } = {}) {
  const llm = client || createClient(cfg);
  const user = buildMasterPrompt({
    paperText: source.paperText || "",
    figures: source.figures || [],
    baseUrl: source.baseUrl || "",
    whatRead: source.whatRead || "unknown",
  });
  return llm.chat(SYSTEM, user);
}
