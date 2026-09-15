import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("conversation routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const publishedJobs: unknown[] = [];
  const app = buildApp({
    repositories,
    queue: { publish: async (job) => void publishedJobs.push(job) }
  });

  beforeEach(async () => {
    publishedJobs.length = 0;
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await repositories.close();
  });

  async function createConversation(): Promise<{ id: string }> {
    const botResponse = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "聊天 Bot", persona: "用于 API 测试" }
    });
    return botResponse.json().conversation;
  }

  it("creates a conversation for a Bot", async () => {
    const botResponse = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "会话 Bot", persona: "用于创建会话" }
    });
    const { bot } = botResponse.json();

    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      payload: { botId: bot.id }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ conversation: { botId: bot.id, userId: "user_local" } });
  });

  it("returns the same not-found response for missing and foreign Bots", async () => {
    const foreignBot = await repositories.createBot({ userId: "user_other", name: "他人的 Bot", persona: "不可访问" });

    for (const botId of ["bot_missing", foreignBot.id]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/conversations",
        payload: { botId }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Bot not found" });
    }
  });

  it("rejects an empty message", async () => {
    const conversation = await createConversation();

    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      payload: { content: "   " }
    });

    expect(response.statusCode).toBe(400);
  });

  it("queues a submitted message with its first task event", async () => {
    const conversation = await createConversation();

    const response = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      payload: { content: "你好" }
    });

    expect(response.statusCode).toBe(202);
    const { message, task } = response.json();
    expect(message).toMatchObject({ conversationId: conversation.id, authorType: "user", content: "你好" });
    expect(task).toMatchObject({ conversationId: conversation.id, messageId: message.id, status: "queued" });
    expect(await repositories.listTaskEvents(task.id, 0)).toMatchObject([{ type: "task.queued", sequence: 1 }]);
    expect(publishedJobs).toEqual([
      expect.objectContaining({
        taskId: task.id,
        conversationId: conversation.id,
        messageId: message.id,
        userId: "user_local"
      })
    ]);
  });

  it("lists messages in a conversation", async () => {
    const conversation = await createConversation();
    await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      payload: { content: "请列出我" }
    });

    const response = await app.inject({ method: "GET", url: `/v1/conversations/${conversation.id}/messages` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ messages: [{ content: "请列出我", authorType: "user" }] });
  });

  it("does not expose messages for a missing conversation", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/conversations/conversation_missing/messages" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Conversation not found" });
  });

  it("rejects a whitespace-only conversation route ID", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/conversations/%20/messages" });

    expect(response.statusCode).toBe(400);
  });

  it("marks the task failed if publication fails after commit", async () => {
    const failingApp = buildApp({
      repositories,
      queue: { publish: async () => Promise.reject(new Error("queue unavailable")) }
    });
    const conversation = await createConversation();

    const response = await failingApp.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/messages`,
      payload: { content: "队列失败" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: "TASK_PUBLICATION_FAILED" },
      task: { status: "failed" }
    });
    const { task } = response.json();
    expect(await repositories.getTask(task.id)).toMatchObject({ status: "failed" });
    expect(await repositories.listTaskEvents(task.id, 0)).toMatchObject([
      { type: "task.queued", sequence: 1 },
      { type: "task.failed", sequence: 2, payload: { errorCode: "TASK_PUBLICATION_FAILED" } }
    ]);
    await failingApp.close();
  });
});
