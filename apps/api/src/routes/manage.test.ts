import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("Manage routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const app = buildApp({
    repositories,
    queue: { publish: async () => undefined }
  });

  beforeEach(async () => {
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
});
