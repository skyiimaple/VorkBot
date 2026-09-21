import { describe, expect, it } from "vitest";
import { isCancelUtterance, parseCreateAssistantIntent } from "./intents.js";

describe("isCancelUtterance", () => {
  it.each(["停", "停止", "取消", "停下", "别说了", "stop", "Cancel", "STOP!"])(
    "matches cancel short-forms: %s",
    (text) => {
      expect(isCancelUtterance(text)).toBe(true);
    }
  );

  it("does not match ordinary questions", () => {
    expect(isCancelUtterance("停止呼吸法是什么")).toBe(false);
    expect(isCancelUtterance("如何取消订阅")).toBe(false);
    expect(isCancelUtterance("请继续")).toBe(false);
  });
});

describe("parseCreateAssistantIntent", () => {
  it("parses 帮我做一个翻译助手", () => {
    expect(parseCreateAssistantIntent("帮我做一个翻译助手")).toEqual({
      topic: "翻译",
      botName: "翻译助手",
      systemPrompt: expect.stringContaining("翻译助手")
    });
  });

  it("parses 我需要一个研究助手", () => {
    const intent = parseCreateAssistantIntent("我需要一个研究助手");
    expect(intent?.botName).toBe("研究助手");
    expect(intent?.systemPrompt).toContain("研究");
  });

  it("parses 创建一个写作助手", () => {
    expect(parseCreateAssistantIntent("创建一个写作助手")?.botName).toBe("写作助手");
  });

  it("does not false-trigger on meta questions", () => {
    expect(parseCreateAssistantIntent("助手这个词怎么翻译")).toBeNull();
    expect(parseCreateAssistantIntent("你是什么助手")).toBeNull();
    expect(parseCreateAssistantIntent("今天天气怎么样")).toBeNull();
  });
});
