import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  DEFAULT_TASK_BUDGET,
  TaskBudgetSchema,
  ToolCallRiskSchema,
  ToolCallSchema,
  ToolCallStatusSchema
} from "./agent.js";

describe("AgentActionSchema", () => {
  it("accepts file.write and message.reply", () => {
    expect(
      AgentActionSchema.parse({
        type: "file.write",
        path: "notes/hello.txt",
        content: "hi"
      })
    ).toMatchObject({ type: "file.write", path: "notes/hello.txt" });

    expect(AgentActionSchema.parse({ type: "message.reply", text: "完成" })).toEqual({
      type: "message.reply",
      text: "完成"
    });
  });

  it("accepts browser, terminal, and complete file tool actions", () => {
    const actions = [
      { type: "browser.navigate", url: "https://example.com" },
      { type: "browser.observe" },
      { type: "browser.click", ref: "button:1" },
      { type: "browser.type", ref: "input:1", text: "hello" },
      { type: "browser.scroll", deltaY: 640 },
      { type: "terminal.start", command: "pnpm test" },
      { type: "terminal.write", sessionId: "term_1", input: "q" },
      { type: "terminal.read", sessionId: "term_1", cursor: 10 },
      { type: "terminal.terminate", sessionId: "term_1" },
      { type: "file.list", path: "src" },
      { type: "file.stat", path: "src/index.ts" },
      { type: "file.mkdir", path: "tmp" },
      { type: "file.move", from: "a.txt", to: "b.txt" },
      { type: "file.delete", path: "tmp", recursive: true }
    ];

    for (const action of actions) {
      expect(AgentActionSchema.parse(action)).toEqual(action);
    }
  });

  it("rejects unknown and malformed tool actions", () => {
    expect(AgentActionSchema.safeParse({ type: "host.execute", command: "whoami" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "file.write", path: "", content: "x" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "terminal.read", sessionId: "", cursor: 0 }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "terminal.read", sessionId: "term_1", cursor: -1 }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "browser.observe", extra: true }).success).toBe(false);
  });
});

describe("TaskBudgetSchema", () => {
  it("accepts DEFAULT_TASK_BUDGET", () => {
    expect(TaskBudgetSchema.parse(DEFAULT_TASK_BUDGET)).toEqual(DEFAULT_TASK_BUDGET);
  });

  it("rejects non-positive limits", () => {
    expect(
      TaskBudgetSchema.safeParse({ maxModelTurns: 0, maxToolCalls: 1, maxDurationMs: 1000 }).success
    ).toBe(false);
  });
});

describe("ToolCallSchema", () => {
  const toolCall = {
    id: "6d9ec8af-6247-4d6f-99ec-2b31da41dd55",
    taskId: "task_1",
    userId: "user_1",
    turn: 1,
    attempt: 0,
    action: { type: "file.write", path: "notes/result.md", content: "hello" },
    risk: "side_effect",
    status: "prepared",
    observation: null,
    errorCode: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z"
  };

  it("accepts only declared risks and lifecycle states", () => {
    expect(ToolCallRiskSchema.options).toEqual(["safe", "side_effect"]);
    expect(ToolCallStatusSchema.options).toEqual(["prepared", "executing", "succeeded", "failed", "uncertain"]);
    expect(ToolCallSchema.parse(toolCall)).toMatchObject({ risk: "side_effect", status: "prepared" });
  });

  it("rejects observations above the checkpoint limit", () => {
    expect(ToolCallSchema.safeParse({ ...toolCall, observation: "x".repeat(4001) }).success).toBe(false);
  });
});
