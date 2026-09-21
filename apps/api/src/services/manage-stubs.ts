import type { Task, TaskListItem } from "@vork/contracts";
import {
  ListModelCredentialsResponseSchema,
  ListSkillsResponseSchema,
  ListWorkspaceFilesResponseSchema,
  TaskListItemSchema,
  type ListModelCredentialsResponse,
  type ListSkillsResponse,
  type ListWorkspaceFilesResponse
} from "@vork/contracts";

const STATUS_LABELS = {
  queued: "排队",
  running: "运行中",
  waiting_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消"
} as const satisfies Record<Task["status"], TaskListItem["statusLabel"]>;

function truncatePreview(content: string, maxLength = 80): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function toTaskListItem(task: Task, messageContent: string): TaskListItem {
  const preview = truncatePreview(messageContent);
  const isBrowserDemo = messageContent.includes("[browser-demo]");
  const isFileDemo = messageContent.includes("[file-demo]");
  const kindLabel = isBrowserDemo || isFileDemo ? "电脑演示" : "对话任务";
  const title = isBrowserDemo
    ? "打开受控演示页"
    : isFileDemo
      ? "整理工作区文件"
      : preview.length > 0
        ? preview
        : "回复用户消息";

  return TaskListItemSchema.parse({
    ...task,
    title,
    kindLabel,
    statusLabel: STATUS_LABELS[task.status],
    messagePreview: preview
  });
}

export function stubSkills(): ListSkillsResponse {
  return ListSkillsResponseSchema.parse({
    source: "stub",
    skills: [
      {
        id: "skill_create_assistant",
        name: "按需创建助手",
        kind: "chat",
        kindLabel: "对话",
        status: "published",
        statusLabel: "已发布",
        summary: "识别「需要一个 XX 助手」意图，创建 Bot 并写入 persona（system prompt）。规则见 skills/create-assistant/SKILL.md。",
        updatedAt: "2026-09-20T00:00:00.000Z"
      },
      {
        id: "skill_cancel_task",
        name: "取消进行中任务",
        kind: "chat",
        kindLabel: "对话",
        status: "published",
        statusLabel: "已发布",
        summary: "识别「停 / 取消」并调用与停止按钮相同的 cancelTask 路径。规则见 skills/cancel-task/SKILL.md。",
        updatedAt: "2026-09-20T00:00:00.000Z"
      },
      {
        id: "skill_stub_browser",
        name: "打开受控演示页",
        kind: "browser",
        kindLabel: "浏览器",
        status: "draft",
        statusLabel: "草稿",
        summary: "在受控浏览器中打开演示页并截图。",
        updatedAt: "2026-09-20T00:00:00.000Z"
      },
      {
        id: "skill_stub_file",
        name: "整理工作区文件",
        kind: "file",
        kindLabel: "文件",
        status: "draft",
        statusLabel: "草稿",
        summary: "在云电脑工作区读写示例文件。",
        updatedAt: "2026-09-20T00:00:00.000Z"
      }
    ]
  });
}

export function stubWorkspaceFiles(): ListWorkspaceFilesResponse {
  return ListWorkspaceFilesResponseSchema.parse({
    source: "stub",
    files: [
      {
        id: "file_stub_screenshot",
        name: "screenshot-preview.jpg",
        path: "screenshot-preview.jpg",
        kind: "file",
        kindLabel: "图片",
        badgeLabel: "示例",
        size: 12_345
      },
      {
        id: "file_stub_notes",
        name: "notes.md",
        path: "notes.md",
        kind: "file",
        kindLabel: "文档",
        badgeLabel: "示例",
        size: 256
      }
    ]
  });
}

export function stubModelCredentials(): ListModelCredentialsResponse {
  return ListModelCredentialsResponseSchema.parse({
    source: "stub",
    currentMode: {
      id: "mode_fake",
      label: "当前模式",
      description: "使用确定性 FakeModel，无需密钥。阶段 3 才会接入真实供应商。"
    },
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
        summary: "确定性假模型，始终可用，无需密钥。"
      }
    ]
  });
}
