import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { SdkTurnInput } from "./agents-sdk-runtime.js";
import { runSdkAgentTask } from "./run-sdk-agent-task.js";

describe("runSdkAgentTask", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  beforeEach(() => resetFoundationDatabase(databaseUrl));
  afterAll(() => repos.close());
  const notifier = { notify: async () => {} };
  async function job() {
    const bot = await repos.createBot({ userId: "user_local", name: "SDK Worker", persona: "assistant" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const { task } = await repos.createQueuedMessageTask({ userId: "user_local", botId: bot.id, conversationId: conversation.id, content: "删除 notes.txt" });
    return { taskId: task.id, userId: task.userId, botId: bot.id, conversationId: conversation.id, messageId: task.messageId };
  }

  it("persists interruptions and resumes the original call after approval", async () => {
    const created = await job();
    const runtime = {
      runTurn: vi.fn(async (input: SdkTurnInput) => {
        if (!input.approveCallId) return { state: '{"pending":"delete_1"}', reply: "", history: input.input, approval: { callId: "delete_1", action: { type: "file.delete" as const, path: "notes.txt" }, reason: "destructive_file_operation" } };
        expect(input.state).toBe('{"pending":"delete_1"}');
        expect(input.approveCallId).toBe("delete_1");
        await input.onState('{"approved":"delete_1"}');
        await input.onApprovalApplied?.("delete_1");
        await input.onDelta("已完成");
        return { state: '{"completed":true}', reply: "已完成", history: input.input };
      })
    };
    await runSdkAgentTask(created, { repos, runtime, notifier });
    expect((await repos.getTask(created.taskId))?.status).toBe("waiting_approval");
    expect((await repos.getPendingApproval(created.taskId))?.action).toMatchObject({ sdkCallId: "delete_1", type: "file.delete" });
    await repos.resolveApproval({ taskId: created.taskId, decision: "approve" });
    await runSdkAgentTask(created, { repos, runtime, notifier });
    expect((await repos.getTask(created.taskId))?.status).toBe("completed");
    expect(await repos.getApprovedSdkAction(created.taskId, created.userId)).toBeNull();
    expect((await repos.getSdkAgentRun(created.taskId, created.userId))?.state).toBe('{"completed":true}');
  });

  it("leaves a cancelled task untouched", async () => {
    const created = await job();
    await repos.cancelTask(created.taskId);
    const runtime = { runTurn: vi.fn() };
    await runSdkAgentTask(created, { repos, runtime, notifier });
    expect(runtime.runTurn).not.toHaveBeenCalled();
    expect((await repos.getTask(created.taskId))?.status).toBe("cancelled");
  });
});
