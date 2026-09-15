import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { FakeModel } from "./fake-model.js";
import { createTaskWorker, RedisTaskNotifier, TASK_JOB_NAME, TASK_QUEUE_NAME, taskEventChannel } from "./queue.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:56379";

describe("BullMQ worker", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  const queueRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const workerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisherRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const subscriberRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(TASK_QUEUE_NAME, { connection: queueRedis });
  const worker = createTaskWorker(
    { repos, model: new FakeModel(["从 Valkey ", "经 BullMQ 回复。"]), notifier: new RedisTaskNotifier(publisherRedis) },
    workerRedis
  );

  beforeEach(async () => {
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await worker.close();
    await queue.close();
    await Promise.all([queueRedis.quit(), workerRedis.quit(), publisherRedis.quit(), subscriberRedis.quit()]);
    await repos.close();
  });

  it("consumes a job published through Valkey and persists the streamed reply", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "集成 Bot", persona: "验证真实队列" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repos.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content: "通过队列发送"
    });
    const job = {
      taskId: queued.task.id,
      userId: queued.task.userId,
      botId: queued.task.botId,
      conversationId: queued.task.conversationId,
      messageId: queued.task.messageId
    };
    const notification = new Promise<string>((resolve) => {
      subscriberRedis.once("message", (_channel, message) => resolve(message));
    });
    await subscriberRedis.subscribe(taskEventChannel(job.taskId));
    const completed = new Promise<void>((resolve, reject) => {
      worker.once("completed", () => resolve());
      worker.once("failed", (_job, error) => reject(error));
    });

    await queue.add(TASK_JOB_NAME, job, { jobId: job.taskId });
    await completed;

    expect(await notification).toContain(job.taskId);
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect((await repos.listTaskEvents(job.taskId, 0)).map((event) => event.type)).toEqual([
      "task.queued",
      "task.running",
      "message.delta",
      "message.delta",
      "message.completed",
      "task.completed"
    ]);
  });
});
