import type { ModelInput, ModelMessage, ModelProvider } from "./model.js";

export type OpenAICompatibleModelOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string | null };
  }>;
};

const DEFAULT_SYSTEM = "你是 Vork 助手，回答简洁有用。";

/** DeepSeek 官方常给 `https://api.deepseek.com`；OpenAI 兼容路径需要 `/v1`。 */
export function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

export class OpenAICompatibleModel implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleModelOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeOpenAICompatibleBaseUrl(options.baseUrl);
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *streamReply(input: ModelInput): AsyncIterable<string> {
    const messages = toChatMessages(input);
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (input.signal) signals.push(input.signal);
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true
      }),
      signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`openai-compatible http ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (!response.body) {
      throw new Error("openai-compatible response missing body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const payload = line.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") {
          if (payload === "[DONE]") return;
          continue;
        }

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(payload) as ChatCompletionChunk;
        } catch {
          continue;
        }

        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length > 0) {
          yield text;
        }
      }
    }
  }
}

function toChatMessages(input: ModelInput): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const system = (input.systemPrompt?.trim() || DEFAULT_SYSTEM).trim();
  const history = (input.messages ?? []).filter((message) => message.content.trim().length > 0);

  if (history.length > 0) {
    return [{ role: "system", content: system }, ...history.map(toRoleMessage)];
  }

  return [
    { role: "system", content: system },
    { role: "user", content: input.userMessage }
  ];
}

function toRoleMessage(message: ModelMessage): { role: "user" | "assistant"; content: string } {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  };
}
