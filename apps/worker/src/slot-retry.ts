import { DelayedError, type Job } from "bullmq";
import { SLOT_EVENT_TYPES, type TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import { ComputerClientError } from "./computer-client.js";
import type { TaskNotifier } from "./queue.js";

export const SLOT_WAIT_CODES = new Set(["no_slot", "browser_concurrency_limit", "memory_pressure"]);
export const MAX_SLOT_WAIT_ATTEMPTS = 60;
export const SLOT_WAIT_DELAY_MS = 5_000;

export class SlotWaitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SlotWaitError";
  }
}

export function isSlotWaitCode(code: string): boolean {
  return SLOT_WAIT_CODES.has(code);
}

export function toSlotWaitError(error: unknown): SlotWaitError | undefined {
  if (error instanceof ComputerClientError && isSlotWaitCode(error.code)) {
    return new SlotWaitError(error.code);
  }
  return undefined;
}

type RetryDeps = {
  repos: Repositories;
  notifier: TaskNotifier;
};

type SlotWaitProgress = {
  slotWaitCount?: number;
};

function readWaitCount(job: Job<TaskJob>): number {
  const progress = job.progress as SlotWaitProgress | number | string;
  if (progress && typeof progress === "object" && typeof progress.slotWaitCount === "number") {
    return progress.slotWaitCount;
  }
  return 0;
}

export async function retryOrFailSlotWait(
  job: Job<TaskJob>,
  taskId: string,
  reason: string,
  deps: RetryDeps
): Promise<never> {
  const nextWait = readWaitCount(job) + 1;

  await deps.repos.appendTaskEvent({
    taskId,
    type: SLOT_EVENT_TYPES.WAITING,
    payload: { reason, attempt: nextWait }
  });
  await deps.notifier.notify(taskId).catch(() => {});

  if (nextWait > MAX_SLOT_WAIT_ATTEMPTS) {
    await deps.repos.appendTaskEvent({
      taskId,
      type: SLOT_EVENT_TYPES.WAIT_EXHAUSTED,
      payload: { reason, attempt: nextWait }
    });
    await deps.repos.failTask(taskId, "SLOT_WAIT_EXHAUSTED");
    await deps.notifier.notify(taskId).catch(() => {});
    throw new Error("slot_wait_exhausted");
  }

  await job.updateProgress({ slotWaitCount: nextWait });
  await job.moveToDelayed(Date.now() + SLOT_WAIT_DELAY_MS, job.token);
  throw new DelayedError();
}
