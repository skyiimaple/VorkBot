import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { TaskJob } from "@vork/contracts";
import { FakeModel } from "./fake-model.js";
import type { TaskNotifier } from "./queue.js";
import { runTask } from "./run-task.js";

describe("runTask routing", () => {
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

  async function createJob(content: string): Promise<TaskJob> {
    const bot = await repos.createBot({ userId: "user_local", name: "Route Bot", persona: "路由" });
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

  it("keeps ordinary chat on FakeModel and ignores demo computer client", async () => {
    const job = await createJob("普通聊天，不要跑 demo");
    const computer = {
      acquire: vi.fn(),
      heartbeat: vi.fn(),
      release: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      navigate: vi.fn(),
      observe: vi.fn(),
      click: vi.fn(),
      type: vi.fn()
    };

    await runTask(job, { repos, model: new FakeModel(["普通", "回复"]), notifier, computer });

    expect(computer.acquire).not.toHaveBeenCalled();
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toMatchObject([
      { authorType: "user", content: "普通聊天，不要跑 demo" },
      { authorType: "assistant", content: "普通回复" }
    ]);
  });

  it("fails [file-demo] cleanly when computer is not configured", async () => {
    const job = await createJob("[file-demo] 写文件");

    await runTask(job, { repos, model: new FakeModel(["不应使用"]), notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect(await repos.listTaskEvents(job.taskId, 0)).toMatchObject([
      { type: "task.queued" },
      { type: "task.failed", payload: { errorCode: "COMPUTER_UNAVAILABLE" } }
    ]);
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toHaveLength(1);
  });

  it("fails [browser-demo] cleanly when computer is not configured", async () => {
    const job = await createJob("请执行 [browser-demo]");

    await runTask(job, { repos, model: new FakeModel(["不应使用"]), notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect((await repos.listTaskEvents(job.taskId, 0)).at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "COMPUTER_UNAVAILABLE" }
    });
  });
});
