import { describe, expect, it, vi } from "vitest";
import { DelayedError } from "bullmq";
import { MAX_SLOT_WAIT_ATTEMPTS, retryOrFailSlotWait } from "./slot-retry.js";

describe("retryOrFailSlotWait", () => {
  it("delays the job and records slot.waiting", async () => {
    const appendTaskEvent = vi.fn(async () => undefined);
    const failTask = vi.fn(async () => undefined);
    const notify = vi.fn(async () => undefined);
    const job = {
      progress: { slotWaitCount: 2 },
      token: "token",
      updateProgress: vi.fn(async () => undefined),
      moveToDelayed: vi.fn(async () => undefined)
    };

    await expect(
      retryOrFailSlotWait(job as never, "task_1", "no_slot", {
        repos: { appendTaskEvent, failTask } as never,
        notifier: { notify }
      })
    ).rejects.toBeInstanceOf(DelayedError);

    expect(appendTaskEvent).toHaveBeenCalledWith({
      taskId: "task_1",
      type: "slot.waiting",
      payload: { reason: "no_slot", attempt: 3 }
    });
    expect(job.updateProgress).toHaveBeenCalledWith({ slotWaitCount: 3 });
    expect(job.moveToDelayed).toHaveBeenCalled();
    expect(failTask).not.toHaveBeenCalled();
  });

  it("fails after max wait attempts", async () => {
    const appendTaskEvent = vi.fn(async () => undefined);
    const failTask = vi.fn(async () => undefined);
    const notify = vi.fn(async () => undefined);
    const job = {
      progress: { slotWaitCount: MAX_SLOT_WAIT_ATTEMPTS },
      token: "token",
      updateProgress: vi.fn(async () => undefined),
      moveToDelayed: vi.fn(async () => undefined)
    };

    await expect(
      retryOrFailSlotWait(job as never, "task_1", "no_slot", {
        repos: { appendTaskEvent, failTask } as never,
        notifier: { notify }
      })
    ).rejects.toThrow("slot_wait_exhausted");

    expect(appendTaskEvent).toHaveBeenCalledWith({
      taskId: "task_1",
      type: "slot.wait_exhausted",
      payload: { reason: "no_slot", attempt: MAX_SLOT_WAIT_ATTEMPTS + 1 }
    });
    expect(failTask).toHaveBeenCalledWith("task_1", "SLOT_WAIT_EXHAUSTED");
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });
});
