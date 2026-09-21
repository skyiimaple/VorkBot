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
