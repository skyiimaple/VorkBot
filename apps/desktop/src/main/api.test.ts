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
});
