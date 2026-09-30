import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskJob } from "@vork/contracts";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentComputerClientLike } from "./computer-client.js";
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

  function mockComputer(): AgentComputerClientLike {
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
      listFiles: vi.fn(async () => ({ entries: [] })),
      statFile: vi.fn(async (_leaseId, path) => ({ path, type: "file" as const, size: 0, modifiedAt: new Date(0).toISOString() })),
      makeDirectory: vi.fn(async (_leaseId, path) => ({ path })),
      moveFile: vi.fn(async (_leaseId, from, to) => ({ from, to })),
      deleteFile: vi.fn(async (_leaseId, path) => ({ path })),
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
      type: vi.fn(async () => ({ ref: "el_1" })),
      scroll: vi.fn(async (_leaseId, deltaY) => ({ deltaY })),
      startTerminal: vi.fn(async () => ({ sessionId: "terminal_1", status: "running" as const, startedAt: new Date(0).toISOString() })),
      writeTerminal: vi.fn(async (_leaseId, sessionId) => ({ sessionId })),
      readTerminal: vi.fn(async (_leaseId, sessionId, cursor = 0) => ({ sessionId, output: "", nextCursor: cursor, truncated: false, status: "running" as const })),
      terminateTerminal: vi.fn(async (_leaseId, sessionId) => ({ sessionId }))
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

  it("pauses on sensitive writes instead of executing them", async () => {
    const job = await createJob("[agent-file] 敏感写入");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "file.write", path: "sensitive/token.txt", content: "secret" }
    ]);

    await runAgentLoop(job, { repos, computer, notifier, actionModel });

    expect((await repos.getTask(job.taskId))?.status).toBe("waiting_approval");
    expect(computer.writeFile).not.toHaveBeenCalled();
    expect((await repos.listTaskEvents(job.taskId, 0)).some((event) => event.type === "approval.request")).toBe(true);
  });

  it("resumes and executes the approved sensitive write then continues", async () => {
    const job = await createJob("[agent-file] 敏感写入续跑");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "file.write", path: "sensitive/token.txt", content: "secret" },
      { type: "message.reply", text: "已写入敏感文件。" },
      { type: "task.complete" }
    ]);

    await runAgentLoop(job, { repos, computer, notifier, actionModel });
    expect((await repos.getTask(job.taskId))?.status).toBe("waiting_approval");
    expect(computer.writeFile).not.toHaveBeenCalled();

    const resolved = await repos.resolveApproval({ taskId: job.taskId, decision: "approve" });
    expect(resolved.task.status).toBe("queued");
    expect(resolved.resume?.approvalId).toBeTruthy();

    await runAgentLoop(job, { repos, computer, notifier, actionModel });

    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(computer.writeFile).toHaveBeenCalledWith("lease_1", "sensitive/token.txt", "secret");
    const messages = await repos.listMessages({
      userId: job.userId,
      conversationId: job.conversationId
    });
    expect(messages.at(-1)).toMatchObject({
      authorType: "assistant",
      content: "已写入敏感文件。"
    });
  });

  it("fails with a clear message when approval is rejected", async () => {
    const job = await createJob("[agent-file] 拒绝敏感写入");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "file.write", path: "sensitive/token.txt", content: "secret" }
    ]);

    await runAgentLoop(job, { repos, computer, notifier, actionModel });
    const rejected = await repos.resolveApproval({ taskId: job.taskId, decision: "reject" });

    expect(rejected.task.status).toBe("failed");
    expect(rejected.resume).toBeUndefined();
    expect(computer.writeFile).not.toHaveBeenCalled();

    const events = await repos.listTaskEvents(job.taskId, 0);
    expect(events.some((event) => event.type === "approval.resolved")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "task.failed",
      payload: {
        errorCode: "APPROVAL_REJECTED",
        message: "你已拒绝写入「sensitive/token.txt」，任务已结束。"
      }
    });
    const messages = await repos.listMessages({
      userId: job.userId,
      conversationId: job.conversationId
    });
    expect(messages.at(-1)?.content).toContain("你已拒绝写入");
  });

  it("saves a normal memory proposal and compresses working memory on complete", async () => {
    const job = await createJob("[agent-file] 记住偏好");
    const computer = mockComputer();
    const actionModel = new FakeActionModel([
      { type: "memory.propose", kind: "fact", content: "喜欢简体中文", sensitivity: "normal" },
      { type: "task.complete" }
    ]);

    await runAgentLoop(job, { repos, computer, notifier, actionModel });

    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    const memories = await repos.listMemories({ userId: job.userId, botId: job.botId });
    expect(memories.some((memory) => memory.content === "喜欢简体中文")).toBe(true);
    expect(memories.some((memory) => memory.kind === "working")).toBe(true);
  });

  it("pauses after an atomic side effect and resumes without repeating it", async () => {
    const job = await createJob("[agent-file] 暂停恢复");
    const computer = mockComputer();
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      vi.mocked(computer.writeFile).mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((release) => { releaseWrite = release; });
        return { path: "notes/agent-hello.txt", bytes: 40 };
      });
    });

    const firstRun = runAgentLoop(job, { repos, computer, notifier });
    await writeStarted;
    await repos.requestTaskPause(job.taskId, job.userId);
    releaseWrite();
    await firstRun;

    expect((await repos.getTask(job.taskId))?.status).toBe("paused");
    expect(computer.writeFile).toHaveBeenCalledTimes(1);

    await repos.resumeTask(job.taskId, job.userId);
    await runAgentLoop(job, { repos, computer, notifier });
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(computer.writeFile).toHaveBeenCalledTimes(1);
  });
});
