import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { createRepositories } from "./repositories.js";

describe("routine repository", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });

  beforeEach(async () => resetFoundationDatabase(databaseUrl));
  afterAll(async () => repos.close());

  async function createBot() {
    return repos.createBot({ userId: "user_local", name: "Routine Bot", persona: "scheduled" });
  }

  it("creates a routine with a permanent dedicated conversation", async () => {
    const bot = await createBot();
    const created = await repos.createRoutineWithConversation({
      userId: "user_local",
      botId: bot.id,
      name: "晨报",
      prompt: "生成晨报",
      trigger: { type: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai",
      now: "2026-09-30T00:00:00.000Z"
    });

    expect(created.routine.conversationId).toBe(created.conversation.id);
    expect(created.routine.nextRunAt).toBe("2026-09-30T01:00:00.000Z");
    await expect(repos.getRoutine(created.routine.id, "user_other")).resolves.toBeNull();
  });

  it("claims one catch-up task and records later overlap without creating another task", async () => {
    const bot = await createBot();
    const { routine } = await repos.createRoutineWithConversation({
      userId: "user_local",
      botId: bot.id,
      name: "每分钟",
      prompt: "执行检查",
      trigger: { type: "cron", expression: "* * * * *" },
      timezone: "Asia/Shanghai",
      now: "2026-09-30T00:00:00.000Z"
    });

    const first = await repos.claimDueRoutineRuns("2026-09-30T00:05:30.000Z", 50);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ run: { missedCount: 4, status: "queued" } });
    expect(first[0]?.taskJob?.conversationId).toBe(routine.conversationId);

    const overlap = await repos.claimDueRoutineRuns("2026-09-30T00:06:30.000Z", 50);
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toMatchObject({ run: { status: "skipped_overlap" }, taskJob: null });
    expect(await repos.listTasks("user_local")).toHaveLength(1);
  });

  it("pauses, resumes from now, and soft deletes without deleting its conversation", async () => {
    const bot = await createBot();
    const { routine, conversation } = await repos.createRoutineWithConversation({
      userId: "user_local",
      botId: bot.id,
      name: "晨报",
      prompt: "生成晨报",
      trigger: { type: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai",
      now: "2026-09-30T00:00:00.000Z"
    });
    const paused = await repos.setRoutineEnabled(routine.id, "user_local", false, "2026-09-30T00:10:00.000Z");
    expect(paused).toMatchObject({ status: "paused", nextRunAt: null });
    const resumed = await repos.setRoutineEnabled(routine.id, "user_local", true, "2026-10-01T00:00:00.000Z");
    expect(resumed).toMatchObject({ status: "active", nextRunAt: "2026-10-01T01:00:00.000Z" });
    const deleted = await repos.softDeleteRoutine(routine.id, "user_local", "2026-10-01T00:10:00.000Z");
    expect(deleted).toMatchObject({ status: "deleted", nextRunAt: null });
    await expect(repos.getConversation({ userId: "user_local", conversationId: conversation.id })).resolves.not.toBeNull();
  });

  it("updates with optimistic versioning while preserving the dedicated conversation", async () => {
    const bot = await createBot();
    const { routine } = await repos.createRoutineWithConversation({
      userId: "user_local",
      botId: bot.id,
      name: "旧名称",
      prompt: "旧提示",
      trigger: { type: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai",
      now: "2026-09-30T00:00:00.000Z"
    });

    const updated = await repos.updateRoutine(routine.id, "user_local", {
      name: "新名称",
      botId: bot.id,
      prompt: "新提示",
      trigger: { type: "cron", expression: "30 9 * * *" },
      timezone: "Asia/Shanghai",
      version: routine.version
    }, "2026-09-30T00:00:00.000Z");
    expect(updated).toMatchObject({
      name: "新名称",
      conversationId: routine.conversationId,
      version: routine.version + 1,
      nextRunAt: "2026-09-30T01:30:00.000Z"
    });
    await expect(repos.updateRoutine(routine.id, "user_local", {
      name: "冲突",
      botId: bot.id,
      prompt: "冲突",
      trigger: { type: "cron", expression: "0 10 * * *" },
      timezone: "Asia/Shanghai",
      version: routine.version
    }, "2026-09-30T00:00:00.000Z")).rejects.toThrow("ROUTINE_VERSION_CONFLICT");
  });

  it("runs immediately, rejects overlap after recording it, and converges publication failure", async () => {
    const bot = await createBot();
    const { routine } = await repos.createRoutineWithConversation({
      userId: "user_local",
      botId: bot.id,
      name: "手动运行",
      prompt: "立即执行",
      trigger: { type: "cron", expression: "0 9 * * *" },
      timezone: "Asia/Shanghai",
      now: "2026-09-30T00:00:00.000Z"
    });

    const dispatch = await repos.runRoutineNow(routine.id, "user_local", "2026-09-30T00:10:00.000Z");
    expect(dispatch.taskJob).not.toBeNull();
    await expect(repos.runRoutineNow(routine.id, "user_local", "2026-09-30T00:11:00.000Z"))
      .rejects.toThrow("ROUTINE_ACTIVE_TASK");
    expect(await repos.listRoutineRuns(routine.id, "user_local", 20)).toHaveLength(2);

    await repos.markRoutinePublicationFailed(dispatch.run.id, "ROUTINE_PUBLICATION_FAILED");
    const runs = await repos.listRoutineRuns(routine.id, "user_local", 20);
    expect(runs.find((run) => run.id === dispatch.run.id)).toMatchObject({
      status: "publication_failed",
      errorCode: "ROUTINE_PUBLICATION_FAILED"
    });
    expect(await repos.getTask(dispatch.taskJob!.taskId)).toMatchObject({ status: "failed" });
  });

  it("keeps routine run status synchronized with every public task lifecycle state", async () => {
    const bot = await createBot();
    let sequence = 0;
    async function newDispatch() {
      sequence += 1;
      const { routine } = await repos.createRoutineWithConversation({
        userId: "user_local",
        botId: bot.id,
        name: `状态测试 ${sequence}`,
        prompt: "执行",
        trigger: { type: "cron", expression: "0 9 * * *" },
        timezone: "Asia/Shanghai",
        now: "2026-09-30T00:00:00.000Z"
      });
      const dispatch = await repos.runRoutineNow(routine.id, "user_local", `2026-09-30T00:0${sequence}:00.000Z`);
      const readStatus = async () => (await repos.listRoutineRuns(routine.id, "user_local", 1))[0]?.status;
      return { dispatch, readStatus };
    }

    const approval = await newDispatch();
    expect(await approval.readStatus()).toBe("queued");
    await repos.appendTaskEvent({ taskId: approval.dispatch.taskJob!.taskId, type: "task.running", payload: {} });
    expect(await approval.readStatus()).toBe("running");
    await repos.requestApproval({ taskId: approval.dispatch.taskJob!.taskId, reason: "确认", action: { type: "file.read", path: "/tmp/a" } });
    expect(await approval.readStatus()).toBe("waiting_approval");

    const pausable = await newDispatch();
    await repos.requestTaskPause(pausable.dispatch.taskJob!.taskId, "user_local");
    expect(await pausable.readStatus()).toBe("paused");
    await repos.resumeTask(pausable.dispatch.taskJob!.taskId, "user_local");
    expect(await pausable.readStatus()).toBe("queued");
    await repos.failTask(pausable.dispatch.taskJob!.taskId, "TEST_FAILURE");
    expect(await pausable.readStatus()).toBe("failed");

    const uncertain = await newDispatch();
    await repos.appendTaskEvent({ taskId: uncertain.dispatch.taskJob!.taskId, type: "task.running", payload: {} });
    const call = await repos.prepareToolCall({
      taskId: uncertain.dispatch.taskJob!.taskId,
      userId: "user_local",
      turn: 1,
      action: { type: "file.write", path: "/tmp/a", content: "x" },
      risk: "side_effect"
    });
    await repos.markToolCallExecuting(call.id, "user_local");
    await repos.markToolCallUncertain(call.id, "user_local");
    expect(await uncertain.readStatus()).toBe("uncertain");
    await repos.resolveUncertainToolCall(uncertain.dispatch.taskJob!.taskId, "user_local", "cancel");
    expect(await uncertain.readStatus()).toBe("cancelled");

    const completed = await newDispatch();
    await repos.completeTaskWithMessage({ taskId: completed.dispatch.taskJob!.taskId, content: "完成" });
    expect(await completed.readStatus()).toBe("completed");
  });
});
