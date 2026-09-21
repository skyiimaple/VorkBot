import { describe, expect, it, vi } from "vitest";
import { FakeModel, FAKE_MODEL_DEFAULT_CHUNKS } from "./fake-model.js";

async function collect(model: FakeModel, userMessage = "你好"): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of model.streamReply({
    botId: "bot_1",
    conversationId: "conversation_1",
    userMessage
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("FakeModel", () => {
  it("streams the default greeting chunks used by smoke and e2e", async () => {
    expect(await collect(new FakeModel())).toEqual([...FAKE_MODEL_DEFAULT_CHUNKS]);
    expect((await collect(new FakeModel())).join("")).toBe("你好，我是 Vork。");
  });

  it("skips empty chunks so message.delta stays meaningful", async () => {
    expect(await collect(new FakeModel(["你好", "", "Vork"]))).toEqual(["你好", "Vork"]);
  });

  it("paces chunks when delayMs is configured", async () => {
    vi.useFakeTimers();
    try {
      const model = new FakeModel({ chunks: ["a", "b"], delayMs: 40 });
      const iterator = model.streamReply({
        botId: "bot_1",
        conversationId: "conversation_1",
        userMessage: "x"
      })[Symbol.asyncIterator]();

      const first = iterator.next();
      await vi.advanceTimersByTimeAsync(39);
      expect(await Promise.race([first.then(() => "done"), Promise.resolve("pending")])).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect((await first).value).toBe("a");

      const second = iterator.next();
      await vi.advanceTimersByTimeAsync(40);
      expect((await second).value).toBe("b");
      expect((await iterator.next()).done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
