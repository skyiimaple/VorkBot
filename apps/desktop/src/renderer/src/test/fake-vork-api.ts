import type { Bot, Conversation, Message, Task, TaskEvent } from "@vork/contracts";
import type { ApiRequest, ApiResponse, TaskEventListener, VorkApi } from "../../../preload/api.js";
import { vi } from "vitest";

const now = "2026-09-15T00:00:00.000Z";

export type FakeVorkApi = VorkApi & {
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
    }
  });

  return {
    request,
    createBot,
    subscribeCalls,
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
