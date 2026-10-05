import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "./repositories.js";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";

describe("SDK agent persistence", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  beforeEach(() => resetFoundationDatabase(databaseUrl));
  afterAll(() => repos.close());

  async function task() {
    const bot = await repos.createBot({ userId: "user_local", name: "SDK persistence", persona: "assistant" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    return (await repos.createQueuedMessageTask({ userId: "user_local", botId: bot.id, conversationId: conversation.id, content: "read" })).task;
  }

  it("stores state only for the owning user", async () => {
    const created = await task();
    await repos.saveSdkAgentRun({ taskId: created.id, userId: "user_local", state: '{"pending":"call_1"}' });
    expect(await repos.getSdkAgentRun(created.id, "user_local")).toMatchObject({ state: '{"pending":"call_1"}' });
    expect(await repos.getSdkAgentRun(created.id, "another_user")).toBeNull();
    await expect(repos.saveSdkAgentRun({ taskId: created.id, userId: "another_user", state: "{}" })).rejects.toThrow();
  });

  it("reuses one persistent tool call for the same SDK call ID", async () => {
    const created = await task();
    const input = { taskId: created.id, userId: "user_local", callId: "sdk_original", action: { type: "file.write" as const, path: "notes.txt", content: "hello" }, risk: "side_effect" as const };
    const first = await repos.prepareSdkToolCall(input);
    const repeated = await repos.prepareSdkToolCall(input);
    expect(repeated.id).toBe(first.id);
    await repos.markToolCallExecuting(first.id, "user_local");
    await repos.finishToolCallAndCheckpoint({ toolCallId: first.id, userId: "user_local", observation: "wrote notes.txt", checkpoint: { nextTurn: 2, lastObservation: "wrote notes.txt", reply: "", modelTurns: 1, toolCalls: 1, lastCompletedToolCallId: first.id } });
    expect(await repos.prepareSdkToolCall(input)).toMatchObject({ id: first.id, status: "succeeded", observation: "wrote notes.txt" });
    await expect(repos.prepareSdkToolCall({ ...input, action: { ...input.action, path: "different.txt" } })).rejects.toThrow("SDK_TOOL_CALL_MISMATCH");
  });
});
