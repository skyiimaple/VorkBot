import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerApiIpc } from "./api.js";

const event = { id: "event_1", taskId: "task_1", userId: "user_1", sequence: 1, type: "message.delta", payload: { text: "hello" }, createdAt: "2026-09-15T00:00:00.000Z" };

function sseResponse(frame: string): Response {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame)); controller.close(); } }), { status: 200 });
}

describe("task event transport", () => {
  it("stops reconnecting when the renderer is destroyed", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn(), on: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    let destroyed = false;
    const webContents = Object.assign(new EventEmitter(), {
      id: 2,
      send: vi.fn(() => { destroyed = true; }),
      isDestroyed: vi.fn(() => destroyed)
    });
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(sseResponse(`data: ${JSON.stringify(event)}\n\n`))
      .mockImplementation((_url, options) => new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    handlers.get("vork:subscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    handlers.get("vork:unsubscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
  });

  it("reconnects after a transport closure using the latest delivered sequence", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn(), on: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const webContents = Object.assign(new EventEmitter(), { id: 1, send: vi.fn(), isDestroyed: vi.fn(() => false) });
    const fetchImplementation = vi.fn().mockResolvedValueOnce(sseResponse(`data: ${JSON.stringify(event)}\n\n`)).mockImplementationOnce((_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    handlers.get("vork:subscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
    expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain("after=1");
    handlers.get("vork:unsubscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
  });

  it("stops reconnecting after a terminal task event", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn(), on: vi.fn((channel, handler) => handlers.set(channel, handler)) };
    const webContents = Object.assign(new EventEmitter(), { id: 3, send: vi.fn(), isDestroyed: vi.fn(() => false) });
    const terminal = {
      ...event,
      id: "event_2",
      sequence: 2,
      type: "task.completed",
      payload: { messageId: "message_1" }
    };
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(`data: ${JSON.stringify(terminal)}\n\n`))
      .mockResolvedValueOnce(sseResponse(`data: ${JSON.stringify(event)}\n\n`));
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    handlers.get("vork:subscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    handlers.get("vork:unsubscribe-task")?.({ sender: webContents }, { taskId: "task_1", afterSequence: 0 });
  });
});

describe("cancelTask request", () => {
  it("maps cancelTask to the cancel HTTP endpoint", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), on: vi.fn() };
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          task: {
            id: "task_1",
            userId: "user_1",
            botId: "bot_1",
            conversationId: "conversation_1",
            messageId: "message_1",
            status: "cancelled",
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: "2026-09-15T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    const result = await handlers.get("vork:request")?.({}, { operation: "cancelTask", input: { taskId: "task_1" } });
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain("/v1/tasks/task_1/cancel");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(result).toMatchObject({ operation: "cancelTask", data: { task: { id: "task_1", status: "cancelled" } } });
  });
});

describe("credential requests", () => {
  it("maps upsertCredential to PUT /v1/credentials", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), on: vi.fn() };
    const payload = {
      source: "database",
      currentMode: {
        id: "mode_remote",
        label: "当前模式",
        description: "已配置 openai-compatible（deepseek-v4-flash）。密钥仅保存，接口不回读明文。"
      },
      credentials: [
        {
          id: "credential_openai_compatible",
          provider: "openai-compatible",
          label: "openai-compatible",
          status: "enabled",
          statusLabel: "启用",
          mode: "remote",
          modeLabel: "远程",
          configured: true,
          summary: "密钥 ****leak · https://api.deepseek.com",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash"
        }
      ]
    };
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
    );
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    const result = await handlers.get("vork:request")?.(
      {},
      {
        operation: "upsertCredential",
        input: {
          provider: "openai-compatible",
          apiKey: "sk-phase3-do-not-leak",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash"
        }
      }
    );
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain("/v1/credentials");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
    expect(result).toMatchObject({ operation: "upsertCredential", data: { source: "database" } });
  });

  it("maps deleteCredential to DELETE /v1/credentials", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), on: vi.fn() };
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          source: "stub",
          currentMode: { id: "mode_fake", label: "当前模式", description: "FakeModel" },
          credentials: []
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    await handlers.get("vork:request")?.({}, { operation: "deleteCredential", input: { provider: "openai-compatible" } });
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain("/v1/credentials");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("maps deleteConversation to DELETE /v1/conversations/:id", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), on: vi.fn() };
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversationId: "conversation_1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    registerApiIpc(ipcMain as never, fetchImplementation as never, 0);

    const result = await handlers.get("vork:request")?.(
      {},
      { operation: "deleteConversation", input: { conversationId: "conversation_1" } }
    );
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain("/v1/conversations/conversation_1");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(result).toMatchObject({ operation: "deleteConversation", data: { conversationId: "conversation_1" } });
  });
});
