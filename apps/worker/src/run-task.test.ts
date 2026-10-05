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
      listFiles: vi.fn(),
      statFile: vi.fn(),
      makeDirectory: vi.fn(),
      moveFile: vi.fn(),
      deleteFile: vi.fn(),
      navigate: vi.fn(),
      observe: vi.fn(),
      click: vi.fn(),
      type: vi.fn(),
      scroll: vi.fn(),
      startTerminal: vi.fn(),
      writeTerminal: vi.fn(),
      readTerminal: vi.fn(),
      terminateTerminal: vi.fn()
    };

    await runTask(job, { repos, model: new FakeModel(["普通", "回复"]), notifier, computer, agentRuntimeMode: "legacy" });

    expect(computer.acquire).not.toHaveBeenCalled();
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toMatchObject([
      { authorType: "user", content: "普通聊天，不要跑 demo" },
      { authorType: "assistant", content: "普通回复" }
    ]);
  });

  it("routes every ordinary message through Agents API when configured", async () => {
    const job = await createJob("查一下今天的新闻");
    const agentRuntime = {
      runTurn: vi.fn(async ({ onDelta }: { onDelta: (delta: string) => void | Promise<void> }) => {
        await onDelta("联网结果");
        return { sessionId: "sess_route", reply: "联网结果" };
      })
    };

    await runTask(job, {
      repos,
      model: new FakeModel(["不应调用"]),
      notifier,
      agentRuntimeMode: "openai-agents",
      agentRuntime
    });

    expect(agentRuntime.runTurn).toHaveBeenCalledOnce();
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toMatchObject([
      { authorType: "user", content: "查一下今天的新闻" },
      { authorType: "assistant", content: "联网结果" }
    ]);
  });

  it("routes natural language through the user's SDK runtime", async () => {
    const job = await createJob("正常聊天也使用 DeepSeek");
    const runtime = {
      runTurn: vi.fn(async () => ({ state: "{}", history: [], reply: "DeepSeek回答" }))
    };
    const sdkRuntimeFactory = vi.fn(async () => runtime);
    await runTask(job, { repos, model: new FakeModel(["不应调用"]), notifier, agentRuntimeMode: "agents-sdk", sdkRuntimeFactory });
    expect(sdkRuntimeFactory).toHaveBeenCalledWith(job.userId);
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect((await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).at(-1)?.content).toBe("DeepSeek回答");
  });

  it("falls back to the basic chat model when Agents API is not configured", async () => {
    const job = await createJob("你好");

    await runTask(job, {
      repos,
      model: new FakeModel(["基础问答仍然可用"]),
      notifier,
      agentRuntimeMode: "openai-agents"
    });

    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(await repos.listMessages({ userId: job.userId, conversationId: job.conversationId })).toMatchObject([
      { authorType: "user", content: "你好" },
      { authorType: "assistant", content: "基础问答仍然可用" }
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

  it("fails [agent-file] cleanly when computer is not configured", async () => {
    const job = await createJob("[agent-file] 写文件");

    await runTask(job, { repos, model: new FakeModel(["不应使用"]), notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect((await repos.listTaskEvents(job.taskId, 0)).at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "COMPUTER_UNAVAILABLE" }
    });
  });

  it("fails [agent-llm] cleanly when computer is not configured", async () => {
    const job = await createJob("[agent-llm] 写文件");

    await runTask(job, { repos, model: new FakeModel(["不应使用"]), notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect((await repos.listTaskEvents(job.taskId, 0)).at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "COMPUTER_UNAVAILABLE" }
    });
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
