import { describe, expect, it, vi } from "vitest";
import {
  createActionModelFromEnv,
  OpenAICompatibleActionModel,
  parseAgentActionFromModelOutput
} from "./action-model.js";
import { FakeActionModel } from "./fake-action-model.js";

describe("parseAgentActionFromModelOutput", () => {
  it("parses bare JSON actions", () => {
    expect(parseAgentActionFromModelOutput('{"type":"task.complete"}')).toEqual({ type: "task.complete" });
    expect(parseAgentActionFromModelOutput('{"type":"file.read","path":"a.txt"}')).toEqual({
      type: "file.read",
      path: "a.txt"
    });
  });

  it("parses fenced JSON", () => {
    expect(
      parseAgentActionFromModelOutput('好的\n```json\n{"type":"message.reply","text":"完成"}\n```')
    ).toEqual({ type: "message.reply", text: "完成" });
  });

  it("returns task.fail for invalid payloads", () => {
    expect(parseAgentActionFromModelOutput("不是 JSON")).toMatchObject({
      type: "task.fail",
      errorCode: "INVALID_AGENT_ACTION"
    });
    expect(parseAgentActionFromModelOutput('{"type":"browser.navigate","url":"x"}')).toMatchObject({
      type: "task.fail",
      errorCode: "INVALID_AGENT_ACTION"
    });
  });
});

describe("OpenAICompatibleActionModel", () => {
  it("requests a non-streaming JSON completion and parses the action", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify({ type: "task.complete" }) } }]
      })
    );

    const model = new OpenAICompatibleActionModel({
      apiKey: "sk-test",
      baseUrl: "https://example.com",
      model: "deepseek-test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(
      model.nextAction({
        botId: "bot_1",
        conversationId: "conv_1",
        userMessage: "[agent-llm] 写个文件",
        turn: 1
      })
    ).resolves.toEqual({ type: "task.complete" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "deepseek-test",
      stream: false,
      response_format: { type: "json_object" }
    });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("[agent-llm] 写个文件");
  });

  it("maps HTTP errors to task.fail MODEL_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const model = new OpenAICompatibleActionModel({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(
      model.nextAction({
        botId: "b",
        conversationId: "c",
        userMessage: "x",
        turn: 1
      })
    ).resolves.toMatchObject({ type: "task.fail", errorCode: "MODEL_UNAVAILABLE" });
  });
});

describe("createActionModelFromEnv", () => {
  it("falls back to FakeActionModel without LLM_API_KEY", () => {
    const model = createActionModelFromEnv({ environment: {} });
    expect(model).toBeInstanceOf(FakeActionModel);
  });

  it("uses OpenAICompatibleActionModel when LLM_API_KEY is set", () => {
    const model = createActionModelFromEnv({
      environment: { LLM_API_KEY: "sk-test", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL: "m" }
    });
    expect(model).toBeInstanceOf(OpenAICompatibleActionModel);
  });

  it("forces Fake when VORK_MODEL_PROVIDER=fake", () => {
    const model = createActionModelFromEnv({
      environment: { LLM_API_KEY: "sk-test", VORK_MODEL_PROVIDER: "fake" }
    });
    expect(model).toBeInstanceOf(FakeActionModel);
  });
});
