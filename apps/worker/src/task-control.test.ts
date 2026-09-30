import { describe, expect, it, vi } from "vitest";
import { createTaskControlMonitor, honorTaskControl } from "./task-control.js";

describe("task control boundaries", () => {
  it("aborts an in-flight model request when cancellation is observed", async () => {
    const repos = { getTask: vi.fn(async () => ({ status: "cancelled", pauseRequestedAt: null })) };
    const monitor = createTaskControlMonitor(repos as never, "task_1", 5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(monitor.signal.aborted).toBe(true);
    monitor.stop();
  });

  it("lands a requested pause only at an explicit boundary", async () => {
    const repos = {
      getTask: vi.fn(async () => ({ status: "running", pauseRequestedAt: new Date().toISOString() })),
      landTaskPause: vi.fn(async () => ({ status: "paused" }))
    };
    await expect(honorTaskControl(repos as never, "task_1", "user_1", {
      nextTurn: 2, lastObservation: "ok", reply: "", modelTurns: 1, toolCalls: 0, lastCompletedToolCallId: null
    })).resolves.toBe("paused");
    expect(repos.landTaskPause).toHaveBeenCalledOnce();
  });
});
