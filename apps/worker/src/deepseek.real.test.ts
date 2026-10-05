import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { createSdkRuntimeFromConfig } from "./create-sdk-runtime.js";
import { ComputerClient } from "./computer-client.js";
import { runSdkAgentTask } from "./run-sdk-agent-task.js";

// Explicit opt-in: uses a real paid model and only a dedicated *_test database.
describe.skipIf(process.env.VORK_REAL_DEEPSEEK_TEST !== "1")("DeepSeek real acceptance", () => {
  let repos: ReturnType<typeof createRepositories>;
  let botId: string;
  let conversationId: string;
  const runtime = createSdkRuntimeFromConfig(process.env);
  const computer = new ComputerClient({ baseUrl: "http://127.0.0.1:18080", token: "sdk_acceptance_only" });
  const notifier = { notify: async () => {} };

  beforeAll(async () => {
    if (!runtime) throw new Error("DeepSeek model is not configured");
    const databaseUrl = getTestDatabaseUrl();
    await resetFoundationDatabase(databaseUrl);
    repos = createRepositories({ databaseUrl });
    const bot = await repos.createBot({ userId: "user_local", name: "DeepSeek验收", persona: "你是验收助手。按要求调用真实工具，简短回复，不要模拟结果。" });
    botId = bot.id;
    conversationId = (await repos.createConversation({ userId: "user_local", botId })).id;
  });
  afterAll(async () => {
    await repos?.close();
    if (repos) await resetFoundationDatabase(getTestDatabaseUrl());
  });

  async function run(content: string) {
    const { task } = await repos.createQueuedMessageTask({ userId: "user_local", botId, conversationId, content });
    const job = { taskId: task.id, userId: task.userId, botId, conversationId, messageId: task.messageId };
    await runSdkAgentTask(job, { repos, runtime: runtime!, computer, notifier });
    return job;
  }

  it("answers, remembers, writes/reads files, runs a terminal and opens a browser", async () => {
    const job = await run("记住验收口令 MAPLE_SDK_2026。请实际写入 acceptance.txt，内容为 MAPLE_SDK_2026，然后读取。再通过终端运行 printf terminal_ok，读取输出。最后浏览器打开 https://example.com 并观察标题。完成后报告文件内容、终端输出和页面标题。");
    const task = await repos.getTask(job.taskId);
    expect(task?.status).toBe("completed");
    const events = await repos.listTaskEvents(job.taskId, 0);
    const invoked = events.filter((event) => event.type === "tool.started").map((event) => (event.payload as { toolName: string }).toolName);
    expect(invoked).toEqual(expect.arrayContaining(["file.write", "file.read", "terminal.start", "terminal.read", "browser.navigate", "browser.observe"]));
    const messages = await repos.listMessages({ userId: "user_local", conversationId });
    expect(messages.at(-1)?.content).toContain("MAPLE_SDK_2026");
    expect(messages.at(-1)?.content).toContain("terminal_ok");
    expect(messages.at(-1)?.content).toContain("Example Domain");
    const followup = await run("刚才我让你记住的验收口令是什么？不要调用工具，只回答口令。");
    expect((await repos.getTask(followup.taskId))?.status).toBe("completed");
    expect((await repos.listMessages({ userId: "user_local", conversationId })).at(-1)?.content).toContain("MAPLE_SDK_2026");
  }, 300_000);

  it("waits for deletion approval, then resumes the same tool call", async () => {
    const job = await run("请删除刚才创建的 acceptance.txt 文件，使用删除工具，完成后告诉我。");
    expect((await repos.getTask(job.taskId))?.status).toBe("waiting_approval");
    const pending = await repos.getPendingApproval(job.taskId);
    expect(pending?.action).toMatchObject({ type: "file.delete", path: "acceptance.txt" });
    expect((pending?.action as { sdkCallId?: string } | undefined)?.sdkCallId).toBeTruthy();
    await repos.resolveApproval({ taskId: job.taskId, decision: "approve" });
    await runSdkAgentTask(job, { repos, runtime: runtime!, computer, notifier });
    expect((await repos.getTask(job.taskId))?.status).toBe("completed");
    expect(await repos.getApprovedSdkAction(job.taskId, job.userId)).toBeNull();
  }, 180_000);
});
