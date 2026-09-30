import { describe, expect, it } from "vitest";
import {
  CheckpointStateSchema,
  TaskControlStateSchema,
  TaskSchema,
  TaskStatusSchema,
  UncertainResolutionInputSchema
} from "./task.js";

const task = {
  id: "task_1",
  userId: "user_1",
  botId: "bot_1",
  conversationId: "conversation_1",
  messageId: "message_1",
  status: "paused",
  pauseRequestedAt: null,
  retryCount: 0,
  nextRetryAt: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z"
};

describe("task recovery contracts", () => {
  it("accepts paused and uncertain task states with recovery metadata", () => {
    expect(TaskStatusSchema.parse("paused")).toBe("paused");
    expect(TaskStatusSchema.parse("uncertain")).toBe("uncertain");
    expect(TaskSchema.parse(task)).toMatchObject({ status: "paused", retryCount: 0 });
    expect(TaskSchema.safeParse({ ...task, retryCount: -1 }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...task, pauseRequestedAt: undefined }).success).toBe(false);
  });

  it("validates bounded checkpoint state", () => {
    const checkpoint = {
      nextTurn: 2,
      lastObservation: "done",
      reply: "working",
      modelTurns: 2,
      toolCalls: 1,
      lastCompletedToolCallId: "6d9ec8af-6247-4d6f-99ec-2b31da41dd55"
    };
    expect(CheckpointStateSchema.parse(checkpoint)).toEqual(checkpoint);
    expect(CheckpointStateSchema.safeParse({ ...checkpoint, lastObservation: "x".repeat(4001) }).success).toBe(false);
  });

  it("exposes only a redacted control summary", () => {
    const result = TaskControlStateSchema.parse({
      task,
      pendingApproval: {
        id: "approval_1",
        actionType: "file.write",
        riskReason: "写入文件需要确认",
        target: "notes/result.md"
      }
    });
    expect(result.pendingApproval).toEqual({
      id: "approval_1",
      actionType: "file.write",
      riskReason: "写入文件需要确认",
      target: "notes/result.md"
    });
    expect(TaskControlStateSchema.safeParse({
      task,
      pendingApproval: {
        id: "approval_1",
        actionType: "file.write",
        riskReason: "写入文件需要确认",
        target: "notes/result.md",
        content: "secret"
      }
    }).success).toBe(false);
  });

  it("accepts only explicit uncertain resolutions", () => {
    for (const resolution of ["confirmed_success", "retry", "cancel"] as const) {
      expect(UncertainResolutionInputSchema.parse({ resolution })).toEqual({ resolution });
    }
    expect(UncertainResolutionInputSchema.safeParse({ resolution: "continue" }).success).toBe(false);
  });
});
