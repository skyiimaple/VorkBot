import { describe, expect, it } from "vitest";
import { CreateBotInputSchema, CreateBotRepositoryInputSchema, CreateQueuedMessageTaskInputSchema, ListBotsInputSchema, MessageSchema, QueuedMessageTaskResultSchema, TaskEventSchema } from "./index";

describe("contracts", () => {
  it("rejects a blank Bot name", () => {
    expect(CreateBotInputSchema.safeParse({ name: "", persona: "Research" }).success).toBe(false);
  });

  it("rejects blank user ownership at the Bot repository boundary", () => {
    expect(
      CreateBotRepositoryInputSchema.safeParse({ userId: "   ", name: "Research", persona: "Researcher" }).success
    ).toBe(false);
    expect(ListBotsInputSchema.safeParse({ userId: "   " }).success).toBe(false);
  });

  it("accepts an ordered task event", () => {
    const result = TaskEventSchema.parse({
      id: "evt_1",
      taskId: "task_1",
      userId: "user_1",
      sequence: 1,
      type: "message.delta",
      payload: { text: "hello" },
      createdAt: "2026-09-14T00:00:00.000Z"
    });
    expect(result.sequence).toBe(1);
  });

  it("rejects a message without its owning user", () => {
    expect(
      MessageSchema.safeParse({
        id: "msg_1",
        conversationId: "conversation_1",
        authorType: "user",
        content: "hello",
        createdAt: "2026-09-14T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects a task event without its owning user", () => {
    expect(
      TaskEventSchema.safeParse({
        id: "evt_1",
        taskId: "task_1",
        sequence: 1,
        type: "message.delta",
        payload: { text: "hello" },
        createdAt: "2026-09-14T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects whitespace-only content before a queued message task reaches persistence", () => {
    expect(
      CreateQueuedMessageTaskInputSchema.safeParse({
        userId: "user_1",
        botId: "bot_1",
        conversationId: "conversation_1",
        content: "   "
      }).success
    ).toBe(false);
  });

  it("accepts the complete queued-message repository result", () => {
    expect(
      QueuedMessageTaskResultSchema.safeParse({
        message: {
          id: "message_1",
          userId: "user_1",
          conversationId: "conversation_1",
          authorType: "user",
          content: "hello",
          createdAt: "2026-09-14T00:00:00.000Z"
        },
        task: {
          id: "task_1",
          userId: "user_1",
          botId: "bot_1",
          conversationId: "conversation_1",
          messageId: "message_1",
          status: "queued",
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z"
        },
        event: {
          id: "event_1",
          taskId: "task_1",
          userId: "user_1",
          sequence: 1,
          type: "task.queued",
          payload: {},
          createdAt: "2026-09-14T00:00:00.000Z"
        }
      }).success
    ).toBe(true);
  });
});
