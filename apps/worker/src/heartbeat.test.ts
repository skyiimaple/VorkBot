import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkerHeartbeat } from "./heartbeat.js";

describe("worker heartbeat", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes a fresh heartbeat and removes it on shutdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T00:00:00.000Z"));
    const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn().mockResolvedValue(1) };

    const stop = await startWorkerHeartbeat(redis as never, 5_000);
    expect(redis.set).toHaveBeenCalledWith("vork:worker:heartbeat", "1789516800000", "EX", 15);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(redis.set).toHaveBeenLastCalledWith("vork:worker:heartbeat", "1789516805000", "EX", 15);
    await stop();
    expect(redis.del).toHaveBeenCalledWith("vork:worker:heartbeat");
  });
});
