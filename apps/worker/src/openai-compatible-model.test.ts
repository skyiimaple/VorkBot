import { describe, expect, it, vi } from "vitest";
import { normalizeOpenAICompatibleBaseUrl, OpenAICompatibleModel } from "./openai-compatible-model.js";

describe("normalizeOpenAICompatibleBaseUrl", () => {
  it("appends /v1 when missing", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1");
    expect(normalizeOpenAICompatibleBaseUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com/v1");
  });

  it("keeps an existing /v1 suffix", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1");
    expect(normalizeOpenAICompatibleBaseUrl("https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1");
  });
});

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = [
    ...chunks.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
    "data: [DONE]\n\n"
  ];
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[index]));
      index += 1;
    }
  });
}

async function collect(model: OpenAICompatibleModel, userMessage = "你好"): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of model.streamReply({
    botId: "bot_1",
    conversationId: "conv_1",
    userMessage,
    systemPrompt: "测试助手",
    messages: [{ role: "user", content: userMessage }]
  })) {
    out.push(chunk);
  }
  return out;
}

describe("OpenAICompatibleModel", () => {
  it("streams delta text from OpenAI-compatible SSE", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(sseBody(["你", "好"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );

    const model = new OpenAICompatibleModel({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1/",
      model: "gpt-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(await collect(model)).toEqual(["你", "好"]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "gpt-test",
      stream: true,
      messages: [
        { role: "system", content: "测试助手" },
        { role: "user", content: "你好" }
      ]
    });
  });

  it("throws a redacted-friendly error on non-OK responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream denied", { status: 401 }));
    const model = new OpenAICompatibleModel({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "gpt-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(collect(model)).rejects.toThrow(/openai-compatible http 401/);
  });

  it("falls back to userMessage when history is empty", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(sseBody(["ok"]), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    );
    const model = new OpenAICompatibleModel({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "gpt-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const chunks: string[] = [];
    for await (const chunk of model.streamReply({
      botId: "bot_1",
      conversationId: "conv_1",
      userMessage: "单独消息"
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["ok"]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "单独消息" });
  });
});
