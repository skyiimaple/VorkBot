import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskJob } from "@vork/contracts";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { runAgentLoop } from "./agent-loop.js";
import type { ComputerClientLike } from "./computer-client.js";
import { FakeActionModel } from "./fake-action-model.js";
import type { TaskNotifier } from "./queue.js";

describe("runAgentLoop", () => {
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
    const bot = await repos.createBot({ userId: "user_local", name: "Agent Bot", persona: "agent" });
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

  function mockComputer(): ComputerClientLike {
    return {
      acquire: vi.fn(async () => ({
        slotId: "slot_1",
        leaseId: "lease_1",
        expiresAt: "2026-09-21T00:01:00.000Z"
      })),
      heartbeat: vi.fn(async () => ({
        slotId: "slot_1",
        leaseId: "lease_1",
        expiresAt: "2026-09-21T00:02:00.000Z"
      })),
      release: vi.fn(async () => {}),
      writeFile: vi.fn(async () => ({ path: "notes/agent-hello.txt", bytes: 40 })),
      readFile: vi.fn(async () => ({
        path: "notes/agent-hello.txt",
        content: "你好，来自受控 Agent 循环。",
        bytes: 40,
        truncated: false
      })),
      observe: vi.fn(async () => ({
        pageId: "page_1",
        url: "about:blank",
        title: "",
        loadState: "loaded" as const,
        elements: [],
        consoleErrors: []
      })),
      navigate: vi.fn(async () => ({ url: "about:blank" })),
      click: vi.fn(async () => ({ ref: "el_1" })),
      type: vi.fn(async () => ({ ref: "el_1" }))
    };
  }

  it("runs write → read → reply → complete via FakeActionModel", async () => {
    const job = await createJob("[agent-file] 请写文件");
    const computer = mockComputer();

    await runAgentLoop(job, { repos, computer, notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(computer.writeFile).toHaveBeenCalled();
    expect(computer.readFile).toHaveBeenCalled();
    expect(computer.release).toHaveBeenCalledWith("lease_1");

    const types = (await repos.listTaskEvents(job.taskId, 0)).map((e) => e.type);
    expect(types).toContain("agent.action");
    expect(types).toContain("tool.started");
    expect(types).toContain("message.delta");
    expect(types.at(-1)).toBe("task.completed");

    const messages = await repos.listMessages({
      userId: job.userId,
      conversationId: job.conversationId
    });
    expect(messages.at(-1)).toMatchObject({
      authorType: "assistant",
      content: "已通过 Agent 循环写入并读取 notes/agent-hello.txt。"
    });
  });

  it("fails when policy denies an unsafe file path", async () => {
    const job = await createJob("[agent-file] 危险路径");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "file.write", path: "../escape.txt", content: "nope" }
    ]);

    await runAgentLoop(job, { repos, computer, notifier, actionModel });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect((await repos.listTaskEvents(job.taskId, 0)).at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "POLICY_DENIED" }
    });
    expect(computer.writeFile).not.toHaveBeenCalled();
  });

  it("fails with budget.exceeded when model turns are exhausted", async () => {
    const job = await createJob("[agent-file] 预算");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "message.reply", text: "一轮" },
      { type: "message.reply", text: "二轮" },
      { type: "message.reply", text: "三轮不该执行" }
    ]);

    await runAgentLoop(job, {
      repos,
      computer,
      notifier,
      actionModel,
      budget: { maxModelTurns: 2, maxToolCalls: 10, maxDurationMs: 60_000 }
    });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    const events = await repos.listTaskEvents(job.taskId, 0);
    expect(events.some((e) => e.type === "budget.exceeded")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "BUDGET_EXCEEDED" }
    });
  });
});
