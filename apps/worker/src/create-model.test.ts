import { describe, expect, it, vi } from "vitest";
import { createModelFromEnv } from "./create-model.js";
import { FakeModel } from "./fake-model.js";
import { OpenAICompatibleModel } from "./openai-compatible-model.js";

describe("createModelFromEnv", () => {
  it("falls back to FakeModel when LLM_API_KEY is missing", () => {
    const model = createModelFromEnv({ environment: {} });
    expect(model).toBeInstanceOf(FakeModel);
  });

  it("uses OpenAICompatibleModel when LLM_API_KEY is set", () => {
    const model = createModelFromEnv({
      environment: {
        LLM_API_KEY: "sk-test",
        LLM_BASE_URL: "https://api.deepseek.com",
        LLM_MODEL: "deepseek-v4-flash"
      }
    });
    expect(model).toBeInstanceOf(OpenAICompatibleModel);
  });

  it("forces FakeModel when VORK_MODEL_PROVIDER=fake", () => {
    const model = createModelFromEnv({
      environment: {
        LLM_API_KEY: "sk-test",
        VORK_MODEL_PROVIDER: "fake"
      }
    });
    expect(model).toBeInstanceOf(FakeModel);
  });

  it("posts to DeepSeek /v1/chat/completions with Bearer key", async () => {
    const fetchImpl = vi.fn(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const model = createModelFromEnv({
      environment: {
        LLM_API_KEY: "sk-test",
        LLM_BASE_URL: "https://api.deepseek.com",
        LLM_MODEL: "deepseek-v4-flash"
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const chunks: string[] = [];
    for await (const chunk of model.streamReply({
      botId: "b",
      conversationId: "c",
      userMessage: "ping"
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hi"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init.body)).model).toBe("deepseek-v4-flash");
  });
});
