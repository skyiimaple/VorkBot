import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  DEFAULT_TASK_BUDGET,
  TaskBudgetSchema
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

  it("rejects unknown action types", () => {
    expect(AgentActionSchema.safeParse({ type: "browser.navigate", url: "https://x" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "file.write", path: "", content: "x" }).success).toBe(false);
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
