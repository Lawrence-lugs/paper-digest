// Stub: real LLMClient implementations owned by agent B (web/js/pipeline/).
export class LLMClient {
  async chat(system, user) {
    throw new Error("NotImplemented: LLMClient.chat");
  }
}
export class OpenRouterClient extends LLMClient {}
export class OpenAICompatibleClient extends LLMClient {}
export class LocalBackendClient extends LLMClient {}
