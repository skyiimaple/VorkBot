import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";
import { openSse } from "../test/open-sse.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:56379";
process.env.REDIS_URL = redisUrl;

describe("task event routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const publisher = new Redis(redisUrl);
  const app = buildApp({
    repositories,
    queue: { publish: async () => undefined }
  });

  beforeEach(async () => {
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([publisher.quit(), repositories.close()]);
  });

  async function seedTaskEvents(types: string[]): Promise<{ id: string }> {
    const bot = await repositories.createBot({ userId: "user_local", name: "SSE Bot", persona: "测试 SSE" });
    const conversation = await repositories.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repositories.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content: "开始流式响应"
    });
    for (const type of types.slice(1)) {
      await repositories.appendTaskEvent({ taskId: queued.task.id, type, payload: type === "message.delta" ? { text: "增量" } : {} });
    }
    return queued.task;
  }

  async function waitForSubscriber(taskId: string): Promise<void> {
    const channel = `vork:tasks:${taskId}:events`;
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const [, subscribers] = await publisher.pubsub("NUMSUB", channel);
      if (Number(subscribers) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("SSE subscriber did not connect to Redis");
  }

  it("replays only events after the supplied cursor", async () => {
    const task = await seedTaskEvents(["task.queued", "task.running", "message.delta"]);

    const response = await openSse(app, `/v1/tasks/${task.id}/events?after=1`, 2);

    expect(response.events.map((event) => event.id)).toEqual(["2", "3"]);
    expect(response.events.map((event) => event.event)).toEqual(["task.running", "message.delta"]);
    expect(response.events[1]?.data).toMatchObject({ taskId: task.id, sequence: 3, payload: { text: "增量" } });
  });

  it("delivers a database event after a live Redis wake-up", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    const response = openSse(app, `/v1/tasks/${task.id}/events?after=0`, 2);
    await waitForSubscriber(task.id);
    await repositories.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await publisher.publish(`vork:tasks:${task.id}:events`, JSON.stringify({ taskId: task.id }));

    expect((await response).events.map((event) => event.id)).toEqual(["1", "2"]);
  });

  it("does not duplicate events for duplicate Redis wake-ups", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    const response = openSse(app, `/v1/tasks/${task.id}/events?after=0`, 2);
    await waitForSubscriber(task.id);
    await repositories.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    const notification = JSON.stringify({ taskId: task.id });
    await publisher.publish(`vork:tasks:${task.id}:events`, notification);
    await publisher.publish(`vork:tasks:${task.id}:events`, notification);

    expect((await response).events.map((event) => event.id)).toEqual(["1", "2"]);
  });
});
