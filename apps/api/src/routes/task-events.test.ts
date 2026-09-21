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

  async function waitForSubscriberRelease(taskId: string): Promise<void> {
    const channel = `vork:tasks:${taskId}:events`;
    for (let attempts = 0; attempts < 100; attempts += 1) {
      const [, subscribers] = await publisher.pubsub("NUMSUB", channel);
      if (Number(subscribers) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("SSE subscriber was not released after the client disconnected");
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
    await waitForSubscriberRelease(task.id);
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

  it("does not expose a task owned by another user", async () => {
    const bot = await repositories.createBot({ userId: "user_other", name: "Private SSE Bot", persona: "私有" });
    const conversation = await repositories.createConversation({ userId: "user_other", botId: bot.id });
    const queued = await repositories.createQueuedMessageTask({
      userId: "user_other",
      botId: bot.id,
      conversationId: conversation.id,
      content: "不应被读取"
    });

    const response = await app.inject({ method: "GET", url: `/v1/tasks/${queued.task.id}/events?after=0` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "任务不存在" });
  });

  it("rejects negative, non-numeric, and fractional event cursors", async () => {
    const task = await seedTaskEvents(["task.queued"]);

    for (const after of ["-1", "not-a-number", "1.5"]) {
      const response = await app.inject({ method: "GET", url: `/v1/tasks/${task.id}/events?after=${after}` });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid request" });
    }
  });

  it("streams a task.failed event that clients can consume", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    await repositories.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await repositories.failTask(task.id, "MODEL_UNAVAILABLE");

    const response = await openSse(app, `/v1/tasks/${task.id}/events?after=0`, 3);

    expect(response.events.map((event) => event.event)).toEqual(["task.queued", "task.running", "task.failed"]);
    expect(response.events[2]?.data).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "MODEL_UNAVAILABLE" }
    });
  });

  it("ends the SSE body after a terminal event so reconnect clients can stop", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    await repositories.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await repositories.failTask(task.id, "MODEL_UNAVAILABLE");

    if (!app.server.address()) {
      await app.listen({ host: "127.0.0.1", port: 0 });
    }
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("SSE test server did not expose a TCP address");

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/tasks/${task.id}/events?after=0`, {
      headers: { accept: "text/event-stream" }
    });
    expect(response.ok).toBe(true);
    const body = await response.text();
    expect(body).toContain("event: task.failed");
    expect(body).not.toContain(": heartbeat");
  });

  it("cancels a queued task and exposes task.cancelled", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    const published: string[] = [];
    const cancellingApp = buildApp({
      repositories,
      queue: { publish: async () => undefined },
      taskEventPublisher: { publish: async (taskId) => void published.push(taskId) }
    });

    const response = await cancellingApp.inject({ method: "POST", url: `/v1/tasks/${task.id}/cancel` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ task: { id: task.id, status: "cancelled" } });
    expect(await repositories.getTask(task.id)).toMatchObject({ status: "cancelled" });
    expect(await repositories.listTaskEvents(task.id, 0)).toMatchObject([
      { type: "task.queued" },
      { type: "task.cancelled", payload: {} }
    ]);
    expect(published).toEqual([task.id]);
    await cancellingApp.close();
  });

  it("rejects cancelling a terminal task", async () => {
    const task = await seedTaskEvents(["task.queued"]);
    await repositories.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await repositories.failTask(task.id, "MODEL_UNAVAILABLE");

    const response = await app.inject({ method: "POST", url: `/v1/tasks/${task.id}/cancel` });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "任务已结束，无法取消" });
  });
});
