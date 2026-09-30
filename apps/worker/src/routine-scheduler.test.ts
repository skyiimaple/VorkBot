import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoutineDispatch } from "@vork/database";
import { scanDueRoutines, startRoutineScheduler } from "./routine-scheduler.js";

function dispatch(id: string, withTask = true): RoutineDispatch {
  return {
    run: {
      id,
      routineId: `routine_${id}`,
      userId: "user_local",
      scheduledFor: "2026-09-30T01:00:00.000Z",
      claimedAt: "2026-09-30T01:00:00.000Z",
      taskId: withTask ? `task_${id}` : null,
      status: withTask ? "queued" : "skipped_overlap",
      missedCount: 0,
      errorCode: null,
      createdAt: "2026-09-30T01:00:00.000Z",
      updatedAt: "2026-09-30T01:00:00.000Z"
    },
    taskJob: withTask ? {
      taskId: `task_${id}`,
      userId: "user_local",
      botId: "bot_1",
      conversationId: "conversation_1",
      messageId: `message_${id}`
    } : null
  };
}

afterEach(() => vi.useRealTimers());

describe("routine scheduler", () => {
  it("claims 50 and publishes each task with a stable job id while ignoring skipped runs", async () => {
    const claimDueRoutineRuns = vi.fn(async () => [dispatch("1"), dispatch("2", false)]);
    const publish = vi.fn(async () => undefined);
    const markRoutinePublicationFailed = vi.fn(async () => dispatch("failed").run);
    await scanDueRoutines({ claimDueRoutineRuns, markRoutinePublicationFailed, publish }, new Date("2026-09-30T01:00:00.000Z"));
    expect(claimDueRoutineRuns).toHaveBeenCalledWith("2026-09-30T01:00:00.000Z", 50);
    expect(publish).toHaveBeenCalledWith(dispatch("1").taskJob, { jobId: "routine-run-1" });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("converges one failed publication and continues the batch", async () => {
    const claimDueRoutineRuns = vi.fn(async () => [dispatch("1"), dispatch("2")]);
    const publish = vi.fn(async (_job: unknown, options?: { jobId?: string }) => {
      if (options?.jobId === "routine-run-1") throw new Error("redis unavailable");
    });
    const markRoutinePublicationFailed = vi.fn(async () => dispatch("failed").run);
    await scanDueRoutines({ claimDueRoutineRuns, markRoutinePublicationFailed, publish }, new Date("2026-09-30T01:00:00.000Z"));
    expect(markRoutinePublicationFailed).toHaveBeenCalledWith("1", "ROUTINE_PUBLICATION_FAILED");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("scans immediately and every five seconds, prevents reentry, and stops cleanly", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const firstScan = new Promise<void>((resolve) => { release = resolve; });
    const claimDueRoutineRuns = vi.fn()
      .mockImplementationOnce(async () => { await firstScan; return []; })
      .mockResolvedValue([]);
    const dependencies = {
      claimDueRoutineRuns,
      markRoutinePublicationFailed: vi.fn(async () => dispatch("failed").run),
      publish: vi.fn(async () => undefined)
    };
    const stop = startRoutineScheduler(dependencies, {
      intervalMs: 5_000,
      now: () => new Date("2026-09-30T01:00:00.000Z")
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(claimDueRoutineRuns).toHaveBeenCalledTimes(1);
    release?.();
    await vi.runOnlyPendingTimersAsync();
    expect(claimDueRoutineRuns).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(claimDueRoutineRuns).toHaveBeenCalledTimes(2);
  });

  it("keeps ticking after a scan error", async () => {
    vi.useFakeTimers();
    const claimDueRoutineRuns = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue([]);
    const stop = startRoutineScheduler({
      claimDueRoutineRuns,
      markRoutinePublicationFailed: vi.fn(async () => dispatch("failed").run),
      publish: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(claimDueRoutineRuns).toHaveBeenCalledTimes(2);
    await stop();
  });
});
