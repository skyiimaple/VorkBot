import { describe, expect, it } from "vitest";
import {
  CreateBotInputSchema,
  CreateBotRepositoryInputSchema,
  CreateQueuedMessageTaskInputSchema,
  ListBotsInputSchema,
  ListModelCredentialsResponseSchema,
  ListSkillsResponseSchema,
  ListTasksResponseSchema,
  ListWorkspaceFilesResponseSchema,
  MessageSchema,
  QueuedMessageTaskResultSchema,
  SkillSchema,
  TaskEventSchema,
  TaskListItemSchema
} from "./index";

describe("contracts", () => {
  it("rejects a blank Bot name", () => {
    expect(CreateBotInputSchema.safeParse({ name: "", persona: "Research" }).success).toBe(false);
  });

  it("rejects blank user ownership at the Bot repository boundary", () => {
    expect(
      CreateBotRepositoryInputSchema.safeParse({ userId: "   ", name: "Research", persona: "Researcher" }).success
    ).toBe(false);
    expect(ListBotsInputSchema.safeParse({ userId: "   " }).success).toBe(false);
  });

  it("accepts an ordered task event", () => {
    const result = TaskEventSchema.parse({
      id: "evt_1",
      taskId: "task_1",
      userId: "user_1",
      sequence: 1,
      type: "message.delta",
      payload: { text: "hello" },
      createdAt: "2026-09-14T00:00:00.000Z"
    });
    expect(result.sequence).toBe(1);
  });

  it("rejects a message without its owning user", () => {
    expect(
      MessageSchema.safeParse({
        id: "msg_1",
        conversationId: "conversation_1",
        authorType: "user",
        content: "hello",
        createdAt: "2026-09-14T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects a task event without its owning user", () => {
    expect(
      TaskEventSchema.safeParse({
        id: "evt_1",
        taskId: "task_1",
        sequence: 1,
        type: "message.delta",
        payload: { text: "hello" },
        createdAt: "2026-09-14T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects whitespace-only content before a queued message task reaches persistence", () => {
    expect(
      CreateQueuedMessageTaskInputSchema.safeParse({
        userId: "user_1",
        botId: "bot_1",
        conversationId: "conversation_1",
        content: "   "
      }).success
    ).toBe(false);
  });

  it("accepts the complete queued-message repository result", () => {
    expect(
      QueuedMessageTaskResultSchema.safeParse({
        message: {
          id: "message_1",
          userId: "user_1",
          conversationId: "conversation_1",
          authorType: "user",
          content: "hello",
          createdAt: "2026-09-14T00:00:00.000Z"
        },
        task: {
          id: "task_1",
          userId: "user_1",
          botId: "bot_1",
          conversationId: "conversation_1",
          messageId: "message_1",
          status: "queued",
          pauseRequestedAt: null,
          retryCount: 0,
          nextRetryAt: null,
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z"
        },
        event: {
          id: "event_1",
          taskId: "task_1",
          userId: "user_1",
          sequence: 1,
          type: "task.queued",
          payload: {},
          createdAt: "2026-09-14T00:00:00.000Z"
        }
      }).success
    ).toBe(true);
  });

  it("accepts manage-page list shapes for tasks, skills, files, and credentials", () => {
    expect(
      TaskListItemSchema.safeParse({
        id: "task_1",
        userId: "user_1",
        botId: "bot_1",
        conversationId: "conversation_1",
        messageId: "message_1",
        status: "completed",
        pauseRequestedAt: null,
        retryCount: 0,
        nextRetryAt: null,
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z",
        title: "回复用户消息",
        kindLabel: "对话任务",
        statusLabel: "已完成",
        messagePreview: "你好"
      }).success
    ).toBe(true);

    expect(
      ListTasksResponseSchema.safeParse({
        tasks: [
          {
            id: "task_1",
            userId: "user_1",
            botId: "bot_1",
            conversationId: "conversation_1",
            messageId: "message_1",
            status: "queued",
            pauseRequestedAt: null,
            retryCount: 0,
            nextRetryAt: null,
            createdAt: "2026-09-14T00:00:00.000Z",
            updatedAt: "2026-09-14T00:00:00.000Z",
            title: "等待云电脑槽位",
            kindLabel: "电脑演示",
            statusLabel: "排队",
            messagePreview: "[browser-demo]"
          }
        ]
      }).success
    ).toBe(true);

    expect(
      SkillSchema.safeParse({
        id: "skill_stub_browser",
        name: "打开受控演示页",
        kind: "browser",
        kindLabel: "浏览器",
        status: "draft",
        statusLabel: "草稿",
        summary: "在受控浏览器中打开演示页并截图。",
        updatedAt: "2026-09-20T00:00:00.000Z"
      }).success
    ).toBe(true);

    expect(
      ListSkillsResponseSchema.safeParse({
        skills: [],
        source: "stub"
      }).success
    ).toBe(true);

    expect(
      ListWorkspaceFilesResponseSchema.safeParse({
        files: [
          {
            id: "file_stub_notes",
            name: "notes.md",
            path: "notes.md",
            kind: "file",
            kindLabel: "文档",
            badgeLabel: "示例"
          }
        ],
        source: "stub"
      }).success
    ).toBe(true);

    expect(
      ListModelCredentialsResponseSchema.safeParse({
        credentials: [
          {
            id: "credential_fake_model",
            provider: "FakeModel",
            label: "FakeModel（内置）",
            status: "enabled",
            statusLabel: "启用",
            mode: "builtin",
            modeLabel: "本地",
            configured: true,
            summary: "确定性假模型，无需密钥。"
          }
        ],
        currentMode: {
          id: "mode_fake",
          label: "当前模式",
          description: "使用确定性 FakeModel，无需密钥。阶段 3 才会接入真实供应商。"
        },
        source: "stub"
      }).success
    ).toBe(true);
  });
});
