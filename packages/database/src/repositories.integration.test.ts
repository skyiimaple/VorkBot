import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetFoundationDatabase } from "@vork/test-support";
import { createRepositories } from "./repositories.js";

describe("repositories", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://vork:vork@localhost:5432/vork";
  const repos = createRepositories({ databaseUrl });

  beforeEach(async () => {
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await repos.close();
  });

  it("persists a Bot, conversation, task and ordered events", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "新建 Bot", persona: "待设置" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "你好" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });

    await repos.appendTaskEvent({ taskId: task.id, type: "task.queued", payload: {} });
    await repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });

    const events = await repos.listTaskEvents(task.id, 0);

    expect(message.userId).toBe("user_local");
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(events.map((event) => event.userId)).toEqual(["user_local", "user_local"]);
  });

  it("allocates distinct, monotonic event sequences for concurrent writes", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "并发 Bot", persona: "测试事件事务" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "开始" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { index } })
      )
    );

    const events = await repos.listTaskEvents(task.id, 0);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("completes a task atomically with its assistant message and terminal events", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "完成 Bot", persona: "测试完成事务" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "请完成" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });

    const completed = await repos.completeTaskWithMessage({ taskId: task.id, content: "已完成" });

    expect(completed.message).toMatchObject({
      userId: "user_local",
      conversationId: conversation.id,
      authorType: "assistant",
      content: "已完成"
    });
    expect((await repos.getTask(task.id))?.status).toBe("completed");
    expect((await repos.listTaskEvents(task.id, 0)).map((event) => event.type)).toEqual([
      "message.completed",
      "task.completed"
    ]);
  });

  it("marks a task failed and stores only its error code in the terminal event", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "失败 Bot", persona: "测试失败事务" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "会失败" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });

    await repos.failTask(task.id, "MODEL_UNAVAILABLE");

    expect((await repos.getTask(task.id))?.status).toBe("failed");
    expect((await repos.listTaskEvents(task.id, 0))[0]).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "MODEL_UNAVAILABLE" }
    });
  });
});
