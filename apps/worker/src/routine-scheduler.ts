import type { RoutineDispatch } from "@vork/database";
import type { TaskJob } from "@vork/contracts";

export type RoutineSchedulerDependencies = {
  claimDueRoutineRuns(now: string, limit: number): Promise<RoutineDispatch[]>;
  markRoutinePublicationFailed(runId: string, errorCode: string): Promise<unknown>;
  publish(job: TaskJob, options?: { jobId?: string }): Promise<unknown>;
};

export type RoutineSchedulerOptions = {
  intervalMs?: number;
  now?: () => Date;
  immediate?: boolean;
  onError?: (error: unknown) => void;
};

export async function scanDueRoutines(
  dependencies: RoutineSchedulerDependencies,
  now: Date
): Promise<void> {
  const dispatches = await dependencies.claimDueRoutineRuns(now.toISOString(), 50);
  for (const dispatch of dispatches) {
    if (!dispatch.taskJob) continue;
    try {
      await dependencies.publish(dispatch.taskJob, { jobId: `routine-run-${dispatch.run.id}` });
    } catch {
      await dependencies.markRoutinePublicationFailed(dispatch.run.id, "ROUTINE_PUBLICATION_FAILED");
    }
  }
}

export function startRoutineScheduler(
  dependencies: RoutineSchedulerDependencies,
  options: RoutineSchedulerOptions = {}
): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 5_000;
  const now = options.now ?? (() => new Date());
  let running: Promise<void> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || running) return;
    running = scanDueRoutines(dependencies, now())
      .catch((error) => options.onError?.(error))
      .finally(() => {
        running = null;
      });
  };

  if (options.immediate !== false) tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
