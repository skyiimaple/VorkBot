import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { TaskJob } from "@vork/contracts";
import { FakeModel } from "./fake-model.js";
import { runChatTask } from "./run-chat-task.js";
import type { TaskNotifier } from "./queue.js";

describe("runChatTask", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  const notifiedTaskIds: string[] = [];
  const notifier: TaskNotifier = {
    notify: async (taskId) => void notifiedTaskIds.push(taskId)
  };

  beforeEach(async () => {
    notifiedTaskIds.length = 0;
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await repos.close();
  });

  async function createJob(content = "你好"): Promise<TaskJob> {
    const bot = await repos.createBot({ userId: "user_local", name: "Worker Bot", persona: "测试 Worker" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repos.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content
    });
    return {
      taskId: queued.task.id,
      userId: queued.task.userId,
      botId: queued.task.botId,
      conversationId: queued.task.conversationId,
      messageId: queued.task.messageId
    };
  }

  it("streams ordered deltas and completes the task", async () => {
    const job = await createJob();

    await runChatTask(job, { repos, model: new FakeModel(["你好，", "我是 Vork。"]), notifier });

    const events = await repos.listTaskEvents(job.taskId, 0);
    expect(events.map((event) => event.type)).toEqual([
      "task.queued",
      "task.running",
      "message.delta",
      "message.delta",
      "message.completed",
      "task.completed"
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toMatchObject([
      { authorType: "user", content: "你好" },
      { authorType: "assistant", content: "你好，我是 Vork。" }
    ]);
    expect(notifiedTaskIds).toEqual([job.taskId, job.taskId, job.taskId, job.taskId]);
  });

  it("does not create another assistant message when a completed job is redelivered", async () => {
    const job = await createJob();
    const model = new FakeModel(["只回答一次"]);

    await runChatTask(job, { repos, model, notifier });
    await runChatTask(job, { repos, model, notifier });

    const messages = await repos.listMessages({ userId: job.userId, conversationId: job.conversationId });
    expect(messages.filter((message) => message.authorType === "assistant")).toHaveLength(1);
    expect(await repos.listTaskEvents(job.taskId, 0)).toHaveLength(5);
  });

  it("lets only one concurrent delivery claim and complete a queued task", async () => {
    const job = await createJob();
    let initialReads = 0;
    let releaseInitialReads: () => void;
    const initialReadsComplete = new Promise<void>((resolve) => {
      releaseInitialReads = resolve;
    });
    let releaseReply: () => void;
    const replyGate = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    const concurrentRepos = {
      ...repos,
      getTask: async (taskId: string) => {
        const snapshot = await repos.getTask(taskId);
        initialReads += 1;
        if (initialReads <= 2) {
          if (initialReads === 2) releaseInitialReads!();
          await initialReadsComplete;
        }
        return snapshot;
      }
    };
    const blockingModel = {
      async *streamReply(): AsyncIterable<string> {
        await replyGate;
        yield "并发回复";
      }
    };
    const deliveries = [
      runChatTask(job, { repos: concurrentRepos, model: blockingModel, notifier }),
      runChatTask(job, { repos: concurrentRepos, model: blockingModel, notifier })
    ];

    try {
      await Promise.race(deliveries);
      expect((await repos.getTask(job.taskId))?.status).toBe("running");
      expect((await repos.listTaskEvents(job.taskId, 0)).map((event) => event.type)).toEqual([
        "task.queued",
        "task.running"
      ]);

      releaseReply!();
      await Promise.all(deliveries);

      expect((await repos.getTask(job.taskId))?.status).toBe("completed");
      expect((await repos.listTaskEvents(job.taskId, 0)).map((event) => event.type)).toEqual([
        "task.queued",
        "task.running",
        "message.delta",
        "message.completed",
        "task.completed"
      ]);
      const messages = await repos.listMessages({ userId: job.userId, conversationId: job.conversationId });
      expect(messages.filter((message) => message.authorType === "assistant")).toHaveLength(1);
    } finally {
      releaseReply!();
      await Promise.allSettled(deliveries);
    }
  });

  it("records a redacted error code when the model fails", async () => {
    const job = await createJob("请勿持久化这段用户消息");
    const failingModel = {
      async *streamReply(): AsyncIterable<string> {
        throw new Error("provider failed while processing 请勿持久化这段用户消息");
      }
    };

    await runChatTask(job, { repos, model: failingModel, notifier });

    const events = await repos.listTaskEvents(job.taskId, 0);
    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "task.failed", payload: { errorCode: "MODEL_UNAVAILABLE" } });
    expect(JSON.stringify(events)).not.toContain("请勿持久化这段用户消息");
  });
});
