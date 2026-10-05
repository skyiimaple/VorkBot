import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import { OpenAIAgentsRuntime, consumeAgentEvents } from "./openai-agents-runtime.js";

async function* events(items: unknown[]): AsyncIterable<AgentSessionEvent> {
  for (const item of items) yield item as AgentSessionEvent;
}

describe("consumeAgentEvents", () => {
  it("returns the created session and streams only final-answer text", async () => {
    const deltas: string[] = [];
    const result = await consumeAgentEvents(events([
      { type: "agent.session.created", session: { id: "sess_1" } },
      { type: "agent.session.turn.item.added", item: { id: "comment_1", type: "message", role: "assistant", phase: "commentary" } },
      { type: "agent.session.turn.output_text.delta", item_id: "comment_1", delta: "正在思考" },
      { type: "agent.session.turn.item.added", item: { id: "answer_1", type: "message", role: "assistant", phase: "final_answer" } },
      { type: "agent.session.turn.output_text.delta", item_id: "answer_1", delta: "你好" },
      { type: "agent.session.turn.output_text.delta", item_id: "answer_1", delta: "！" },
      { type: "agent.session.turn.completed" }
    ]), undefined, (delta) => {
      deltas.push(delta);
    });

    expect(result).toEqual({ sessionId: "sess_1", reply: "你好！" });
    expect(deltas).toEqual(["你好", "！"]);
  });

  it("fails when the managed turn fails", async () => {
    await expect(consumeAgentEvents(events([
      { type: "agent.session.turn.failed", turn: { error: { code: "model_error" } } }
    ]), "sess_existing", () => {})).rejects.toMatchObject({ code: "OPENAI_AGENT_TURN_FAILED" });
  });

  it("reports a new session before a later stream failure", async () => {
    const onSessionCreated = vi.fn(async () => {});
    await expect(consumeAgentEvents(events([
      { type: "agent.session.created", session: { id: "sess_recoverable" } },
      { type: "agent.session.turn.failed", turn: { error: { code: "model_error" } } }
    ]), undefined, () => {}, { onSessionCreated })).rejects.toMatchObject({ code: "OPENAI_AGENT_TURN_FAILED" });
    expect(onSessionCreated).toHaveBeenCalledWith("sess_recoverable");
  });
});

describe("OpenAIAgentsRuntime", () => {
  it("creates a web-enabled session for the first message", async () => {
    const create = vi.fn(async () => events([
      { type: "agent.session.created", session: { id: "sess_new" } },
      { type: "agent.session.turn.item.added", item: { id: "answer", type: "message", role: "assistant", phase: "final_answer" } },
      { type: "agent.session.turn.output_text.delta", item_id: "answer", delta: "结果" },
      { type: "agent.session.turn.completed" }
    ]));
    const runtime = new OpenAIAgentsRuntime({
      model: "gpt-6-astra",
      client: { beta: { agents: { sessions: { create, stream: vi.fn() } } } } as never
    });

    await runtime.runTurn({ input: "今天的新闻", instructions: "你是研究助手", onDelta: () => {} });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      environment: { type: "none" },
      input: "今天的新闻",
      stream: true,
      agent: expect.objectContaining({
        model: "gpt-6-astra",
        instructions: "你是研究助手",
        tools: expect.arrayContaining([
          { type: "web_search", mode: "live" },
          expect.objectContaining({ type: "function", name: "vork_file_read" }),
          expect.objectContaining({ type: "function", name: "vork_terminal_start" }),
          expect.objectContaining({ type: "function", name: "vork_browser_navigate" })
        ])
      })
    }));
  });

  it("executes a required function and submits its result during the first turn", async () => {
    const submit = vi.fn(async () => ({}));
    const onToolCall = vi.fn(async () => "read notes.txt: hello");
    const create = vi.fn(async () => events([
      { type: "agent.session.created", session: { id: "sess_tools" } },
      {
        type: "agent.session.requires_action",
        session: {
          id: "sess_tools",
          required_actions: [{
            type: "function_call",
            turn_id: "turn_1",
            call_id: "call_1",
            name: "vork_file_read",
            arguments: { path: "notes.txt" }
          }]
        }
      },
      { type: "agent.session.turn.item.added", item: { id: "answer", type: "message", role: "assistant", phase: "final_answer" } },
      { type: "agent.session.turn.output_text.delta", item_id: "answer", delta: "文件内容是 hello" },
      { type: "agent.session.turn.completed" }
    ]));
    const runtime = new OpenAIAgentsRuntime({
      model: "gpt-6-astra",
      client: { beta: { agents: { sessions: { create, stream: vi.fn(), events: { create: submit } } } } } as never
    });

    const result = await runtime.runTurn({
      input: "读 notes.txt",
      instructions: "使用文件工具",
      onDelta: () => {},
      onToolCall
    });

    expect(onToolCall).toHaveBeenCalledWith({ type: "file.read", path: "notes.txt" });
    expect(submit).toHaveBeenCalledWith("sess_tools", {
      events: [{
        type: "agent.session.input.tool_result",
        turn_id: "turn_1",
        call_id: "call_1",
        success: true,
        output: "read notes.txt: hello"
      }]
    });
    expect(result.reply).toBe("文件内容是 hello");
  });

  it("continues an existing session instead of creating another one", async () => {
    const stream = vi.fn(() => events([
      { type: "agent.session.turn.item.added", item: { id: "answer", type: "message", role: "assistant", phase: "final_answer" } },
      { type: "agent.session.turn.output_text.delta", item_id: "answer", delta: "继续" },
      { type: "agent.session.turn.completed" }
    ]));
    const create = vi.fn();
    const runtime = new OpenAIAgentsRuntime({
      model: "gpt-6-astra",
      client: { beta: { agents: { sessions: { create, stream } } } } as never
    });

    const result = await runtime.runTurn({
      sessionId: "sess_existing",
      input: "继续",
      instructions: "不会重建",
      onDelta: () => {}
    });

    expect(result).toEqual({ sessionId: "sess_existing", reply: "继续" });
    expect(stream).toHaveBeenCalledWith("sess_existing", { input: "继续", toolHandlers: {} });
    expect(create).not.toHaveBeenCalled();
  });

  it("registers tool handlers when continuing an existing session", async () => {
    const stream = vi.fn((_sessionId: string, params: { toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<string>> }) => {
      void params.toolHandlers.vork_browser_navigate({ url: "https://example.com" });
      return events([
        { type: "agent.session.turn.item.added", item: { id: "answer", type: "message", role: "assistant", phase: "final_answer" } },
        { type: "agent.session.turn.output_text.delta", item_id: "answer", delta: "已打开" },
        { type: "agent.session.turn.completed" }
      ]);
    });
    const onToolCall = vi.fn(async () => "navigated");
    const runtime = new OpenAIAgentsRuntime({
      model: "gpt-6-astra",
      client: { beta: { agents: { sessions: { create: vi.fn(), stream } } } } as never
    });

    await runtime.runTurn({
      sessionId: "sess_existing",
      input: "打开网页",
      instructions: "使用浏览器",
      onDelta: () => {},
      onToolCall
    });

    expect(onToolCall).toHaveBeenCalledWith({ type: "browser.navigate", url: "https://example.com" });
  });
});
