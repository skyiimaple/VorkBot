import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { createRepositories } from "./repositories.js";

describe("task recovery repository", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });

  beforeEach(async () => resetFoundationDatabase(databaseUrl));
  afterAll(async () => repos.close());

  async function createTask(userId = "user_local") {
    const bot = await repos.createBot({ userId, name: "Recovery Bot", persona: "safe" });
    const conversation = await repos.createConversation({ userId, botId: bot.id });
    return repos.createQueuedMessageTask({ userId, botId: bot.id, conversationId: conversation.id, content: "run" });
  }

  it("pauses queued tasks immediately and requests a boundary pause for running tasks", async () => {
    const queued = await createTask();
    const paused = await repos.requestTaskPause(queued.task.id, "user_local");
    expect(paused).toMatchObject({ status: "paused", pauseRequestedAt: null });

    const running = await createTask();
    await repos.appendTaskEvent({ taskId: running.task.id, type: "task.running", payload: {} });
    const requested = await repos.requestTaskPause(running.task.id, "user_local");
    expect(requested.status).toBe("running");
    expect(requested.pauseRequestedAt).not.toBeNull();
    expect((await repos.listTaskEvents(running.task.id, 0)).at(-1)?.type).toBe("task.pause_requested");
  });

  it("appends monotonically versioned checkpoints scoped to the owning user", async () => {
    const queued = await createTask();
    const state = {
      nextTurn: 1,
      lastObservation: "ok",
      reply: "",
      modelTurns: 1,
      toolCalls: 0,
      lastCompletedToolCallId: null
    };
    const first = await repos.saveTaskCheckpoint({ taskId: queued.task.id, userId: "user_local", state });
    const second = await repos.saveTaskCheckpoint({ taskId: queued.task.id, userId: "user_local", state: { ...state, nextTurn: 2 } });
    expect([first.version, second.version]).toEqual([1, 2]);
    await expect(repos.getLatestTaskCheckpoint(queued.task.id, "user_other")).resolves.toBeNull();
    await expect(repos.getLatestTaskCheckpoint(queued.task.id, "user_local")).resolves.toMatchObject({ version: 2, state: { nextTurn: 2 } });
  });

  it("persists a successful tool result, checkpoint, and event atomically", async () => {
    const queued = await createTask();
    const call = await repos.prepareToolCall({
      taskId: queued.task.id,
      userId: "user_local",
      turn: 0,
      attempt: 0,
      action: { type: "file.write", path: "result.txt", content: "done" },
      risk: "side_effect"
    });
    await repos.markToolCallExecuting(call.id, "user_local");
    await repos.finishToolCallAndCheckpoint({
      toolCallId: call.id,
      userId: "user_local",
      observation: "written",
      checkpoint: {
        nextTurn: 1,
        lastObservation: "written",
        reply: "",
        modelTurns: 1,
        toolCalls: 1,
        lastCompletedToolCallId: call.id
      }
    });
    expect(await repos.getLatestTaskCheckpoint(queued.task.id, "user_local")).toMatchObject({ state: { lastObservation: "written" } });
    expect((await repos.listTaskEvents(queued.task.id, 0)).at(-2)?.type).toBe("checkpoint.saved");
    expect((await repos.listTaskEvents(queued.task.id, 0)).at(-1)?.type).toBe("tool.finished");
  });

  it("lists an executing side effect as recoverable without exposing it to another user", async () => {
    const queued = await createTask();
    await repos.appendTaskEvent({ taskId: queued.task.id, type: "task.running", payload: {} });
    const call = await repos.prepareToolCall({
      taskId: queued.task.id,
      userId: "user_local",
      turn: 0,
      attempt: 0,
      action: { type: "terminal.start", command: "echo hi" },
      risk: "side_effect"
    });
    await repos.markToolCallExecuting(call.id, "user_local");
    expect(await repos.listRecoverableTasks()).toEqual([
      expect.objectContaining({ task: expect.objectContaining({ id: queued.task.id }), incompleteToolCall: expect.objectContaining({ id: call.id }) })
    ]);
    await expect(repos.markToolCallExecuting(call.id, "user_other")).rejects.toThrow("Tool call does not exist");
  });

  it("allocates a new attempt when retrying the same turn", async () => {
    const queued = await createTask();
    const action = { type: "file.write", path: "result.txt", content: "done" } as const;
    const first = await repos.prepareToolCall({
      taskId: queued.task.id,
      userId: "user_local",
      turn: 1,
      action,
      risk: "side_effect"
    });
    await repos.markToolCallExecuting(first.id, "user_local");
    await repos.markToolCallUncertain(first.id, "user_local");
    await repos.resolveUncertainToolCall(queued.task.id, "user_local", "retry");

    const retried = await repos.prepareToolCall({
      taskId: queued.task.id,
      userId: "user_local",
      turn: 1,
      action,
      risk: "side_effect"
    });

    expect([first.attempt, retried.attempt]).toEqual([0, 1]);
  });
});
