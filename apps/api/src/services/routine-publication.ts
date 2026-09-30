import type { RoutineDispatch } from "@vork/database";
import type { TaskQueue } from "./chat-service.js";

type RoutinePublicationRepository = {
  markRoutinePublicationFailed(runId: string, errorCode: string): Promise<unknown>;
};

export class RoutinePublicationError extends Error {
  constructor() {
    super("ROUTINE_PUBLICATION_FAILED");
    this.name = "RoutinePublicationError";
  }
}

export async function publishRoutineDispatch(
  dispatch: RoutineDispatch,
  queue: TaskQueue,
  repositories: RoutinePublicationRepository
): Promise<void> {
  if (!dispatch.taskJob) return;
  try {
    await queue.publish(dispatch.taskJob, { jobId: `routine-run-${dispatch.run.id}` });
  } catch {
    await repositories.markRoutinePublicationFailed(dispatch.run.id, "ROUTINE_PUBLICATION_FAILED");
    throw new RoutinePublicationError();
  }
}
