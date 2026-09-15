import { describe, expect, it, vi } from "vitest";
import { createVorkApi } from "./api.js";

const taskEvent = {
  id: "event_1",
  taskId: "task_1",
  userId: "user_1",
  sequence: 1,
  type: "message.delta",
  payload: { text: "hello" },
  createdAt: "2026-09-14T00:00:00.000Z"
};

describe("createVorkApi", () => {
  it("rejects unknown request operations before invoking IPC", async () => {
    const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
    const api = createVorkApi(ipcRenderer);

    await expect(api.request({ operation: "arbitrary-channel", input: {} } as never)).rejects.toThrow();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("does not accept an arbitrary URL or IPC channel in the renderer API", async () => {
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ operation: "taskEvent", event: taskEvent }),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    };
    const api = createVorkApi(ipcRenderer);

    await expect(api.request({ operation: "listBots", input: {}, url: "https://attacker.example", channel: "evil" } as never)).rejects.toThrow();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("rejects unsupported fields inside an allowlisted request", async () => {
    const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
    const api = createVorkApi(ipcRenderer);

    await expect(
      api.request({ operation: "createBot", input: { name: "Research", persona: "Researcher", url: "https://attacker.example" } } as never)
    ).rejects.toThrow();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("validates task events received from the fixed IPC channel", () => {
    const ipcRenderer = { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
    const listener = vi.fn();
    const api = createVorkApi(ipcRenderer);

    const unsubscribe = api.subscribeTask("task_1", 0, listener);
    const eventListener = ipcRenderer.on.mock.calls[0]?.[1] as (_event: unknown, payload: unknown) => void;
    eventListener({}, { taskId: "task_1", event: taskEvent });
    eventListener({}, { taskId: "task_1", event: { ...taskEvent, sequence: 0 } });
    unsubscribe();

    expect(ipcRenderer.on).toHaveBeenCalledWith("vork:task-event", expect.any(Function));
    expect(ipcRenderer.send).toHaveBeenCalledWith("vork:subscribe-task", { taskId: "task_1", afterSequence: 0 });
    expect(listener).toHaveBeenCalledExactlyOnceWith(taskEvent);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith("vork:task-event", eventListener);
  });
});
