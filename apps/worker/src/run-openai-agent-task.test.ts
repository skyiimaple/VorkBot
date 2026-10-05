import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { TaskJob } from "@vork/contracts";
import { runOpenAIAgentTask } from "./run-openai-agent-task.js";
import type { TaskNotifier } from "./queue.js";
import type { OpenAIAgentsTurnInput } from "./openai-agents-runtime.js";

function createComputer() {
  return {
    acquire: vi.fn(async () => ({ leaseId: "lease_agents", slotId: "slot_agents", expiresAt: new Date(Date.now() + 60_000).toISOString() })),
    heartbeat: vi.fn(async () => ({ leaseId: "lease_agents", slotId: "slot_agents", expiresAt: new Date(Date.now() + 60_000).toISOString() })),
    release: vi.fn(async () => {}),
    readFile: vi.fn(async () => ({ path: "notes.txt", content: "hello", truncated: false })),
    writeFile: vi.fn(), listFiles: vi.fn(), statFile: vi.fn(), makeDirectory: vi.fn(), moveFile: vi.fn(),
    deleteFile: vi.fn(async (_leaseId: string, path: string) => ({ path })),
    navigate: vi.fn(), observe: vi.fn(), click: vi.fn(), type: vi.fn(), scroll: vi.fn(),
    startTerminal: vi.fn(), writeTerminal: vi.fn(), readTerminal: vi.fn(), terminateTerminal: vi.fn()
  };
}

describe("runOpenAIAgentTask", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  const notifier: TaskNotifier = { notify: vi.fn(async () => {}) };

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await repos.close();
  });

  async function createJob(content: string): Promise<TaskJob> {
    const bot = await repos.createBot({ userId: "user_local", name: "Agents Worker", persona: "你是 Vork 助手" });
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

  it("streams a first turn, stores its session and completes the Vork task", async () => {
    const job = await createJob("查一下今天的新闻");
    const runtime = {
      runTurn: vi.fn(async ({ onDelta }: { onDelta: (text: string) => void | Promise<void> }) => {
        await onDelta("今日");
        await onDelta("新闻");
        return { sessionId: "sess_first", reply: "今日新闻" };
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier });

    expect(runtime.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      input: "查一下今天的新闻",
      instructions: "你是 Vork 助手",
      sessionId: undefined
    }));
    await expect(repos.getAgentSession({
      userId: job.userId,
      conversationId: job.conversationId,
      runtime: "openai-agents"
    })).resolves.toMatchObject({ externalSessionId: "sess_first" });
    expect((await repos.listTaskEvents(job.taskId, 0)).map((event) => event.type)).toEqual([
      "task.queued",
      "task.running",
      "message.delta",
      "message.delta",
      "message.completed",
      "task.completed"
    ]);
  });

  it("stores a created session even when its first turn fails", async () => {
    const job = await createJob("需要恢复的任务");
    const runtime = {
      runTurn: vi.fn(async ({ onSessionCreated }: OpenAIAgentsTurnInput) => {
        await onSessionCreated?.("sess_recoverable");
        throw new Error("stream interrupted");
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier });

    await expect(repos.getAgentSession({
      userId: job.userId,
      conversationId: job.conversationId,
      runtime: "openai-agents"
    })).resolves.toMatchObject({ externalSessionId: "sess_recoverable" });
    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
  });

  it("reuses the stored Agents session on the next turn", async () => {
    const first = await createJob("第一条");
    const runtime = {
      runTurn: vi.fn(async ({ sessionId, onDelta }: { sessionId?: string; onDelta: (text: string) => void | Promise<void> }) => {
        await onDelta(sessionId ? "继续" : "开始");
        return { sessionId: sessionId ?? "sess_shared", reply: sessionId ? "继续" : "开始" };
      })
    };
    await runOpenAIAgentTask(first, { repos, runtime, notifier });
    const queued = await repos.createQueuedMessageTask({
      userId: first.userId,
      botId: first.botId,
      conversationId: first.conversationId,
      content: "第二条"
    });

    await runOpenAIAgentTask({
      taskId: queued.task.id,
      userId: queued.task.userId,
      botId: queued.task.botId,
      conversationId: queued.task.conversationId,
      messageId: queued.task.messageId
    }, { repos, runtime, notifier });

    expect(runtime.runTurn).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "sess_shared", input: "第二条" }));
  });

  it("executes Agents function calls through the lazy Vork Computer lease", async () => {
    const job = await createJob("读取 notes.txt");
    const computer = createComputer();
    const runtime = {
      runTurn: vi.fn(async ({ onToolCall, onDelta }: OpenAIAgentsTurnInput) => {
        const observation = await onToolCall!({ type: "file.read", path: "notes.txt" });
        await onDelta(observation);
        return { sessionId: "sess_tools", reply: observation };
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });

    expect(computer.acquire).toHaveBeenCalledTimes(1);
    expect(computer.readFile).toHaveBeenCalledWith("lease_agents", "notes.txt");
    expect(computer.release).toHaveBeenCalledWith("lease_agents");
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
  });

  it("leaves approval-required tool calls waiting instead of failing the task", async () => {
    const job = await createJob("删除 notes.txt");
    const computer = createComputer();
    const runtime = {
      runTurn: vi.fn(async ({ onToolCall }: OpenAIAgentsTurnInput) => {
        await onToolCall!({ type: "file.delete", path: "notes.txt" });
        return { sessionId: "sess_approval", reply: "等待批准" };
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });

    expect((await repos.getTask(job.taskId))?.status).toBe("waiting_approval");
    expect(computer.acquire).not.toHaveBeenCalled();
  });

  it("executes an approved tool action and returns its observation to the Agents session", async () => {
    const job = await createJob("删除 notes.txt");
    const computer = createComputer();
    const inputs: string[] = [];
    let first = true;
    const runtime = {
      runTurn: vi.fn(async ({ input, onToolCall }: OpenAIAgentsTurnInput) => {
        inputs.push(input);
        if (first) {
          first = false;
          try {
            await onToolCall!({ type: "file.delete", path: "notes.txt" });
          } catch {
            // The remote harness receives a failed tool result while Vork waits for approval.
          }
          return { sessionId: "sess_approval_resume", reply: "等待批准" };
        }
        return { sessionId: "sess_approval_resume", reply: "已删除 notes.txt" };
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });
    expect((await repos.getTask(job.taskId))?.status).toBe("waiting_approval");
    await repos.resolveApproval({ taskId: job.taskId, decision: "approve" });

    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });

    expect(computer.deleteFile).toHaveBeenCalledWith("lease_agents", "notes.txt", undefined);
    expect(inputs.at(-1)).toContain("deleted notes.txt");
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
  });

  it("keeps distinct tool turns when approval resumes after a completed call", async () => {
    const job = await createJob("读完再删除 notes.txt");
    const computer = createComputer();
    let first = true;
    const runtime = {
      runTurn: vi.fn(async ({ onToolCall }: OpenAIAgentsTurnInput) => {
        if (first) {
          first = false;
          await onToolCall!({ type: "file.read", path: "notes.txt" });
          await expect(onToolCall!({ type: "file.delete", path: "notes.txt" })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
          return { sessionId: "sess_two_calls", reply: "等待批准" };
        }
        return { sessionId: "sess_two_calls", reply: "已删除" };
      })
    };

    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });
    await repos.resolveApproval({ taskId: job.taskId, decision: "approve" });
    await runOpenAIAgentTask(job, { repos, runtime, notifier, computer: computer as never });

    const checkpoint = await repos.getLatestTaskCheckpoint(job.taskId, job.userId);
    expect(checkpoint?.state.nextTurn).toBe(3);
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
  });

  it("records a stable error when the Agents runtime is unavailable", async () => {
    const job = await createJob("会失败");

    await runOpenAIAgentTask(job, { repos, notifier });

    expect((await repos.getTask(job.taskId))?.status).toBe("failed");
    expect((await repos.listTaskEvents(job.taskId, 0)).at(-1)).toMatchObject({
      type: "task.failed",
      payload: { errorCode: "OPENAI_AGENTS_NOT_CONFIGURED" }
    });
  });
});
