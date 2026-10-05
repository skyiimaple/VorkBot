import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { AgentsSdkRuntime } from "./agents-sdk-runtime.js";

function response(delta: Record<string, unknown>, finishReason = "stop") {
  const chunks = [
    { id: "completion_test", object: "chat.completion.chunk", created: 1, model: "deepseek-v4-flash", choices: [{ index: 0, delta, finish_reason: null }] },
    { id: "completion_test", object: "chat.completion.chunk", created: 1, model: "deepseek-v4-flash", choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }
  ];
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" }
  });
}

function setup(replies: Response[]) {
  const requests: Record<string, any>[] = [];
  const client = new OpenAI({ apiKey: "test-key", baseURL: "https://deepseek.test/v1", maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      const next = replies.shift();
      if (!next) throw new Error("Unexpected model request");
      return next;
    }
  });
  return { requests, runtime: new AgentsSdkRuntime({ client, model: "deepseek-v4-flash", deepseek: true }) };
}

describe("AgentsSdkRuntime", () => {
  it("uses DeepSeek Chat Completions with history and streams the answer", async () => {
    const { runtime, requests } = setup([response({ role: "assistant", content: "你好，Maple" })]);
    const deltas: string[] = [];
    const result = await runtime.runTurn({
      name: "first", instructions: "你是助手", input: [{ role: "user", content: "我叫 Maple" }, { role: "assistant", status: "completed", content: [{ type: "output_text", text: "你好" }] }, { role: "user", content: "我叫什么？" }],
      onDelta: (delta) => { deltas.push(delta); }, onToolCall: async () => "unused", onState: async () => {}
    });
    expect(result.reply).toBe("你好，Maple");
    expect(deltas.join("")).toBe("你好，Maple");
    expect(requests[0].model).toBe("deepseek-v4-flash");
    expect(requests[0].thinking).toEqual({ type: "disabled" });
    expect(requests[0].messages).toEqual(expect.arrayContaining([{ role: "user", content: "我叫 Maple" }]));
  });

  it("restores an approval and sends its result with the original call ID", async () => {
    const { runtime, requests } = setup([
      response({ role: "assistant", tool_calls: [{ index: 0, id: "delete_original", type: "function", function: { name: "vork_file_delete", arguments: '{"path":"notes.txt"}' } }] }, "tool_calls"),
      response({ role: "assistant", content: "已删除" })
    ]);
    const executed: string[] = [];
    const input = {
      name: "first", instructions: "你是助手", input: [{ role: "user" as const, content: "删除 notes.txt" }],
      onDelta: () => {}, onState: async () => {},
      onToolCall: async (_action: unknown, callId: string) => { executed.push(callId); return "deleted notes.txt"; }
    };
    const paused = await runtime.runTurn(input);
    expect(paused.approval).toMatchObject({ callId: "delete_original", action: { type: "file.delete", path: "notes.txt" } });
    expect(executed).toEqual([]);

    const resumed = await runtime.runTurn({ ...input, state: paused.state, approveCallId: "delete_original" });
    expect(resumed.reply).toBe("已删除");
    expect(executed).toEqual(["delete_original"]);
    expect(requests[1].messages).toEqual(expect.arrayContaining([{ role: "tool", tool_call_id: "delete_original", content: "deleted notes.txt" }]));
  });

  it("restores saved state after a model failure without repeating a completed effect", async () => {
    const { runtime } = setup([
      response({ role: "assistant", tool_calls: [{ index: 0, id: "write_original", type: "function", function: { name: "vork_file_write", arguments: '{"path":"notes.txt","content":"hello"}' } }] }, "tool_calls"),
      new Response('{"error":{"message":"offline"}}', { status: 500, headers: { "content-type": "application/json" } })
    ]);
    let saved = "";
    const completed = new Map<string, string>();
    let effects = 0;
    const input = {
      name: "first", instructions: "assistant", input: [{ role: "user", content: "write notes" }],
      onDelta: () => {}, onState: async (state: string) => { saved = state; },
      onToolCall: async (_action: unknown, callId: string) => {
        const existing = completed.get(callId);
        if (existing) return existing;
        effects++;
        completed.set(callId, "wrote notes.txt");
        return "wrote notes.txt";
      }
    };
    await expect(runtime.runTurn(input)).rejects.toThrow();
    expect(effects).toBe(1);
    const resumedRuntime = setup([response({ role: "assistant", content: "已完成" })]);
    const resumed = await resumedRuntime.runtime.runTurn({ ...input, state: saved });
    expect(resumed.reply).toBe("已完成");
    expect(effects).toBe(1);
    expect(resumedRuntime.requests[0].messages).toEqual(expect.arrayContaining([{ role: "tool", tool_call_id: "write_original", content: "wrote notes.txt" }]));
  });
});
