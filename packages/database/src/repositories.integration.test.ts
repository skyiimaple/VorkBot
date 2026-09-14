import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { createRepositories } from "./repositories.js";

describe("repositories", () => {
  const databaseUrl = getTestDatabaseUrl();
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
    expect((await repos.getTask(task.id))?.status).toBe("running");
    expect((await repos.listTaskEvents(task.id, 1)).map((event) => event.sequence)).toEqual([2]);
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
    await expect(repos.failTask(task.id, "MODEL_UNAVAILABLE")).rejects.toThrow("Terminal tasks cannot be failed again");
    expect((await repos.getTask(task.id))?.status).toBe("completed");
    expect(await repos.listTaskEvents(task.id, 0)).toHaveLength(2);
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

    await repos.failTask(task.id, "MODEL_UNAVAILABLE");
    await expect(repos.completeTaskWithMessage({ taskId: task.id, content: "不应创建" })).rejects.toThrow(
      "Terminal tasks cannot be completed again"
    );
    expect(await repos.listTaskEvents(task.id, 0)).toHaveLength(1);
  });

  it("rejects task references crossing users or conversations", async () => {
    const aliceBot = await repos.createBot({ userId: "user_alice", name: "Alice Bot", persona: "Alice" });
    const aliceConversation = await repos.createConversation({ userId: "user_alice", botId: aliceBot.id });
    const aliceMessage = await repos.appendMessage({
      conversationId: aliceConversation.id,
      authorType: "user",
      content: "Alice 的消息"
    });
    const bobBot = await repos.createBot({ userId: "user_bob", name: "Bob Bot", persona: "Bob" });
    const bobConversation = await repos.createConversation({ userId: "user_bob", botId: bobBot.id });
    const bobMessage = await repos.appendMessage({
      conversationId: bobConversation.id,
      authorType: "user",
      content: "Bob 的消息"
    });

    await expect(
      repos.createTask({
        userId: "user_bob",
        botId: bobBot.id,
        conversationId: aliceConversation.id,
        messageId: aliceMessage.id
      })
    ).rejects.toThrow("Task references resources outside its user ownership boundary");
    await expect(
      repos.createTask({
        userId: "user_alice",
        botId: aliceBot.id,
        conversationId: aliceConversation.id,
        messageId: bobMessage.id
      })
    ).rejects.toThrow("Task references resources outside its user ownership boundary");
  });

  it("keeps terminal task outcomes mutually exclusive when completion races failure", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "竞态 Bot", persona: "测试终态" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "竞态" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });

    const results = await Promise.allSettled([
      repos.completeTaskWithMessage({ taskId: task.id, content: "完成" }),
      repos.failTask(task.id, "MODEL_UNAVAILABLE")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const events = await repos.listTaskEvents(task.id, 0);
    expect(events.filter((event) => event.type === "task.completed" || event.type === "task.failed")).toHaveLength(1);
  });

  it("rolls back a sequence increment when event serialization fails", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "回滚 Bot", persona: "测试回滚" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "回滚" });
    const task = await repos.createTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      messageId: message.id
    });
    const circularPayload: { self?: unknown } = {};
    circularPayload.self = circularPayload;

    await expect(repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: circularPayload })).rejects.toThrow();
    await repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { text: "可序列化" } });

    expect((await repos.listTaskEvents(task.id, 0)).map((event) => event.sequence)).toEqual([1]);
  });
});
