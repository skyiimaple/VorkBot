import { describe, expect, it } from "vitest";
import { CreateBotInputSchema, MessageSchema, TaskEventSchema } from "./index";

describe("contracts", () => {
  it("rejects a blank Bot name", () => {
    expect(CreateBotInputSchema.safeParse({ name: "", persona: "Research" }).success).toBe(false);
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
});
