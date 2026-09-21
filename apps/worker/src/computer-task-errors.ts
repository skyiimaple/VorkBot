import { LEASE_EVENT_TYPES, TOOL_EVENT_TYPES } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import { ComputerClientError } from "./computer-client.js";
import type { TaskNotifier } from "./queue.js";

type FailComputerTaskDeps = {
  repos: Repositories;
  notifier: TaskNotifier;
};

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Redis only wakes live consumers; durable task events remain the source of truth.
  }
}

export function isLeaseLostError(error: unknown): boolean {
  return error instanceof ComputerClientError && error.code === "lease_expired";
}

export function toolFailureReason(error: unknown): string {
  if (error instanceof ComputerClientError) {
    return error.code;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "computer_error";
}

export async function appendToolFailed(
  taskId: string,
  toolName: string,
  error: unknown,
  deps: FailComputerTaskDeps
): Promise<void> {
  await deps.repos.appendTaskEvent({
    taskId,
    type: TOOL_EVENT_TYPES.FAILED,
    payload: { toolName, reason: toolFailureReason(error) }
  });
  await notify(deps.notifier, taskId);
}

export async function failComputerTask(
  taskId: string,
  error: unknown,
  deps: FailComputerTaskDeps
): Promise<void> {
  if (isLeaseLostError(error)) {
    await deps.repos.appendTaskEvent({
      taskId,
      type: LEASE_EVENT_TYPES.LOST,
      payload: { reason: "lease_expired" }
    });
    await deps.repos.failTask(taskId, "LEASE_LOST");
    await notify(deps.notifier, taskId);
    return;
  }

  await deps.repos.failTask(taskId, "COMPUTER_UNAVAILABLE");
  await notify(deps.notifier, taskId);
}
