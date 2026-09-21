import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@vork/contracts";

const redisState = vi.hoisted(() => ({
  disconnect: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn()
}));

vi.mock("ioredis", () => ({
  default: class {
    on = redisState.on;
    off = redisState.off;
    subscribe = redisState.subscribe;
    unsubscribe = redisState.unsubscribe;
    disconnect = redisState.disconnect;
  }
}));

import { RedisTaskEventSubscriber, TaskEventStream, type TaskEventSubscriber } from "./event-stream.js";

describe("RedisTaskEventSubscriber", () => {
  it("disconnects the Redis client when subscribing fails", async () => {
    const failure = new Error("subscription unavailable");
    redisState.subscribe.mockRejectedValueOnce(failure);
    const subscriber = new RedisTaskEventSubscriber("redis://127.0.0.1:56379");

    await expect(subscriber.subscribe("task_1", () => undefined)).rejects.toThrow(failure);

    expect(redisState.off).toHaveBeenCalledWith("message", expect.any(Function));
    expect(redisState.disconnect).toHaveBeenCalledOnce();
  });
});

describe("TaskEventStream", () => {
  it("rejects malformed task events before writing an SSE frame", async () => {
    const malformedEvent = {
      id: "event_1",
      taskId: "task_1",
      userId: "user_local",
      sequence: 1,
      type: "task.queued",
      payload: {},
      createdAt: "not-an-ISO-timestamp"
    } as unknown as TaskEvent;
    const subscriber: TaskEventSubscriber = {
      subscribe: async () => ({ close: async () => undefined })
    };
    const writes: string[] = [];
    const stream = new TaskEventStream(
      { listTaskEvents: async () => [malformedEvent] },
      subscriber,
      { write: (chunk) => (writes.push(chunk), true) },
      "task_1",
      0
    );

    let error: unknown;
    try {
      await stream.open();
    } catch (caught) {
      error = caught;
    }
    await stream.close();

    expect(error).toBeDefined();
    expect(writes).toEqual([]);
  });

  it("ends the writer after delivering a terminal task event", async () => {
    const terminalEvent = {
      id: "event_1",
      taskId: "task_1",
      userId: "user_local",
      sequence: 1,
      type: "task.failed",
      payload: { errorCode: "MODEL_UNAVAILABLE" },
      createdAt: "2026-09-15T00:00:00.000Z"
    } as TaskEvent;
    const subscribe = vi.fn(async () => ({ close: async () => undefined }));
    const end = vi.fn();
    const writes: string[] = [];
    const stream = new TaskEventStream(
      { listTaskEvents: async () => [terminalEvent] },
      { subscribe },
      { write: (chunk) => (writes.push(chunk), true), end },
      "task_1",
      0
    );

    await stream.open();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("event: task.failed");
    expect(end).toHaveBeenCalledOnce();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
