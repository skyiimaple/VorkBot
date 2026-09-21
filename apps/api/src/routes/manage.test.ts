import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("Manage routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const publishedJobs: Array<{ taskId: string; jobId?: string }> = [];
  const app = buildApp({
    repositories,
    queue: {
      publish: async (job, options) => {
        publishedJobs.push({ taskId: job.taskId, jobId: options?.jobId });
      }
    }
  });

  beforeEach(async () => {
    publishedJobs.length = 0;
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await repositories.close();
  });

  it("lists real tasks with Chinese display fields", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "管理 Bot", persona: "任务列表" }
    });
    const conversationId = created.json().conversation.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { content: "你好" }
    });
    await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { content: "[browser-demo] 打开演示" }
    });

    const response = await app.inject({ method: "GET", url: "/v1/tasks" });

    expect(response.statusCode).toBe(200);
    expect(response.json().tasks).toEqual([
      expect.objectContaining({
        title: "打开受控演示页",
        kindLabel: "电脑演示",
        statusLabel: "排队",
        messagePreview: "[browser-demo] 打开演示"
      }),
      expect.objectContaining({
        title: "你好",
        kindLabel: "对话任务",
        statusLabel: "排队",
        messagePreview: "你好"
      })
    ]);
  });

  it("returns stub skills aligned with the manage page drafts", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/skills" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "stub",
      skills: [
        { name: "按需创建助手", kindLabel: "对话", statusLabel: "已发布" },
        { name: "取消进行中任务", kindLabel: "对话", statusLabel: "已发布" },
        { name: "打开受控演示页", kindLabel: "浏览器", statusLabel: "草稿" },
        { name: "整理工作区文件", kindLabel: "文件", statusLabel: "草稿" }
      ]
    });
  });

  it("returns stub workspace files for the manage files page", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/files" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "stub",
      files: [
        { name: "screenshot-preview.jpg", kindLabel: "图片", badgeLabel: "示例" },
        { name: "notes.md", kindLabel: "文档", badgeLabel: "示例" }
      ]
    });
  });

  it("returns stub model credentials with FakeModel enabled", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/credentials" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: "stub",
      currentMode: {
        label: "当前模式",
        description: "使用确定性 FakeModel，无需密钥。阶段 3 才会接入真实供应商。"
      },
      credentials: [{ label: "FakeModel（内置）", statusLabel: "启用", modeLabel: "本地" }]
    });
  });

  it("stores a model credential without returning the raw key", async () => {
    const secret = "sk-phase3-do-not-leak";
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/credentials",
      payload: {
        provider: "openai-compatible",
        apiKey: secret,
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash"
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.stringify(saved.json())).not.toContain(secret);
    expect(saved.json()).toMatchObject({
      source: "database",
      credentials: [
        {
          configured: true,
          summary: expect.stringContaining("****leak"),
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash"
        }
      ]
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/credentials",
      payload: { provider: "openai-compatible" }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().source).toBe("stub");
  });

  it("approves a sensitive memory and saves the task as a skill draft", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "审批 Bot", persona: "记忆" }
    });
    const botId = created.json().bot.id as string;
    const conversationId = created.json().conversation.id as string;
    const queued = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { content: "记住敏感事项" }
    });
    const taskId = queued.json().task.id as string;
    await repositories.requestApproval({
      taskId,
      reason: "sensitive_memory",
      action: { type: "memory.propose", kind: "fact", content: "证件号 123", sensitivity: "sensitive" }
    });

    const approved = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/approvals`,
      payload: { decision: "approve" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().task.status).toBe("completed");
    expect(publishedJobs.some((job) => job.jobId?.includes(":resume:"))).toBe(false);

    const memories = await app.inject({ method: "GET", url: `/v1/bots/${botId}/memories` });
    expect(memories.json().memories).toEqual([
      expect.objectContaining({ content: "证件号 123", sensitivity: "sensitive" })
    ]);

    const saved = await app.inject({ method: "POST", url: "/v1/skills", payload: { taskId } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().skill.status).toBe("draft");
    const skills = await app.inject({ method: "GET", url: "/v1/skills" });
    expect(skills.json().source).toBe("database");
    expect(skills.json().skills[0]).toMatchObject({ status: "draft", statusLabel: "草稿" });
  });

  it("requeues a sensitive file write after approval", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "文件审批 Bot", persona: "文件" }
    });
    const conversationId = created.json().conversation.id as string;
    const queued = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { content: "写敏感文件" }
    });
    const taskId = queued.json().task.id as string;
    await repositories.requestApproval({
      taskId,
      reason: "sensitive_write",
      action: { type: "file.write", path: "sensitive/token.txt", content: "secret" }
    });

    const approved = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/approvals`,
      payload: { decision: "approve" }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().task.status).toBe("queued");
    expect(publishedJobs.some((job) => job.taskId === taskId && job.jobId?.startsWith(`${taskId}:resume:`))).toBe(
      true
    );
  });

  it("rejects approval with a clear failure message", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "拒绝审批 Bot", persona: "文件" }
    });
    const conversationId = created.json().conversation.id as string;
    const queued = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { content: "写敏感文件" }
    });
    const taskId = queued.json().task.id as string;
    await repositories.requestApproval({
      taskId,
      reason: "sensitive_write",
      action: { type: "file.write", path: "sensitive/token.txt", content: "secret" }
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/approvals`,
      payload: { decision: "reject" }
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().task.status).toBe("failed");

    const events = await repositories.listTaskEvents(taskId, 0);
    expect(events.at(-1)).toMatchObject({
      type: "task.failed",
      payload: {
        errorCode: "APPROVAL_REJECTED",
        message: "你已拒绝写入「sensitive/token.txt」，任务已结束。"
      }
    });
  });
});
