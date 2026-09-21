import type { Bot, Conversation, Message, Task, TaskEvent } from "@vork/contracts";
import type { ApiRequest, ApiResponse, TaskEventListener, VorkApi } from "../../../preload/api.js";
import { vi } from "vitest";

const now = "2026-09-15T00:00:00.000Z";

export type FakeVorkApi = VorkApi & {
  request: ReturnType<typeof vi.fn>;
  createBot: ReturnType<typeof vi.fn>;
  subscribeCalls: Array<{ taskId: string; afterSequence: number }>;
  emitTaskEvent(taskId: string, event: TaskEvent): void;
};

export function createFakeVorkApi(): FakeVorkApi {
  const bots: Bot[] = [];
  const conversations: Conversation[] = [];
  const messages = new Map<string, Message[]>();
  const listeners = new Map<string, Set<TaskEventListener>>();
  const subscribeCalls: Array<{ taskId: string; afterSequence: number }> = [];
  let nextId = 1;

  const createBot = vi.fn(async (input: { name: string; persona: string }) => {
    const id = `bot_${nextId++}`;
    const bot = { id, userId: "user_local", ...input, createdAt: now, updatedAt: now };
    const conversation = { id: `conversation_${nextId++}`, userId: "user_local", botId: id, createdAt: now, updatedAt: now };
    bots.push(bot);
    conversations.push(conversation);
    messages.set(conversation.id, []);
    return { operation: "createBot" as const, data: { bot, conversation } };
  });

  const request = vi.fn(async (input: ApiRequest): Promise<ApiResponse> => {
    switch (input.operation) {
      case "listBots":
        return { operation: "listBots", data: { bots: [...bots] } };
      case "listConversations":
        return { operation: "listConversations", data: { conversations: [...conversations] } };
      case "createBot":
        return createBot(input.input);
      case "createConversation": {
        const conversation = { id: `conversation_${nextId++}`, userId: "user_local", botId: input.input.botId, createdAt: now, updatedAt: now };
        conversations.push(conversation);
        messages.set(conversation.id, []);
        return { operation: "createConversation", data: { conversation } };
      }
      case "listMessages":
        return { operation: "listMessages", data: { messages: [...(messages.get(input.input.conversationId) ?? [])] } };
      case "submitMessage": {
        const id = `message_${nextId++}`;
        const message: Message = { id, userId: "user_local", conversationId: input.input.conversationId, authorType: "user", content: input.input.content, createdAt: now };
        const task: Task = { id: `task_${nextId++}`, userId: "user_local", botId: "bot_1", conversationId: input.input.conversationId, messageId: id, status: "queued", createdAt: now, updatedAt: now };
        messages.set(input.input.conversationId, [...(messages.get(input.input.conversationId) ?? []), message]);
        return { operation: "submitMessage", data: { message, task } };
      }
      case "cancelTask": {
        const task: Task = {
          id: input.input.taskId,
          userId: "user_local",
          botId: "bot_1",
          conversationId: "conversation_1",
          messageId: "message_1",
          status: "cancelled",
          createdAt: now,
          updatedAt: now
        };
        return { operation: "cancelTask", data: { task } };
      }
      case "listTasks":
        return { operation: "listTasks", data: { tasks: [] } };
      case "listSkills":
        return {
          operation: "listSkills",
          data: {
            source: "stub",
            skills: [
              {
                id: "skill_stub_browser",
                name: "打开受控演示页",
                kind: "browser",
                kindLabel: "浏览器",
                status: "draft",
                statusLabel: "草稿",
                summary: "在受控浏览器中打开演示页并截图。",
                updatedAt: now
              }
            ]
          }
        };
      case "listFiles":
        return {
          operation: "listFiles",
          data: {
            source: "stub",
            files: [
              {
                id: "file_stub_notes",
                name: "notes.md",
                path: "notes.md",
                kind: "file",
                kindLabel: "文档",
                badgeLabel: "示例"
              }
            ]
          }
        };
      case "listCredentials":
        return {
          operation: "listCredentials",
          data: {
            source: "stub",
            currentMode: {
              id: "mode_fake",
              label: "当前模式",
              description: "使用确定性 FakeModel，无需密钥。配置远程凭据后 Worker 可走真实供应商。"
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
          }
        };
      case "upsertCredential": {
        const masked = `****${input.input.apiKey.slice(-4)}`;
        return {
          operation: "upsertCredential",
          data: {
            source: "database",
            currentMode: {
              id: "mode_remote",
              label: "当前模式",
              description: `已配置 ${input.input.provider}（${input.input.model ?? "默认模型"}）。密钥仅保存，接口不回读明文。`
            },
            credentials: [
              {
                id: "credential_openai_compatible",
                provider: input.input.provider,
                label: input.input.provider,
                status: "enabled",
                statusLabel: "启用",
                mode: "remote",
                modeLabel: "远程",
                configured: true,
                summary: `密钥 ${masked}${input.input.baseUrl ? ` · ${input.input.baseUrl}` : ""}`,
                baseUrl: input.input.baseUrl,
                model: input.input.model
              }
            ]
          }
        };
      }
      case "deleteCredential":
        return {
          operation: "deleteCredential",
          data: {
            source: "stub",
            currentMode: {
              id: "mode_fake",
              label: "当前模式",
              description: "使用确定性 FakeModel，无需密钥。配置远程凭据后 Worker 可走真实供应商。"
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
          }
        };
      default:
        throw new Error(`unsupported operation: ${(input as { operation: string }).operation}`);
    }
  });

  return {
    request,
    createBot,
    subscribeCalls,
    getComputerFrame: vi.fn(async () => ({
      base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")
    })),
    subscribeTask(taskId, afterSequence, listener) {
      subscribeCalls.push({ taskId, afterSequence });
      const taskListeners = listeners.get(taskId) ?? new Set<TaskEventListener>();
      taskListeners.add(listener);
      listeners.set(taskId, taskListeners);
      return () => taskListeners.delete(listener);
    },
    emitTaskEvent(taskId, event) {
      for (const listener of listeners.get(taskId) ?? []) listener(event);
    }
  };
}
