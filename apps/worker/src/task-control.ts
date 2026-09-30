import type { CheckpointState } from "@vork/contracts";
import type { Repositories } from "@vork/database";

export function createTaskControlMonitor(
  repos: Pick<Repositories, "getTask">,
  taskId: string,
  intervalMs = 500
): { signal: AbortSignal; stop(): void } {
  const controller = new AbortController();
  const timer = setInterval(() => {
    void repos.getTask(taskId).then((task) => {
      if (!task || task.status === "cancelled") controller.abort();
    }).catch(() => {});
  }, intervalMs);
  return { signal: controller.signal, stop: () => clearInterval(timer) };
}

export async function honorTaskControl(
  repos: Pick<Repositories, "getTask" | "landTaskPause">,
  taskId: string,
  userId: string,
  checkpoint: CheckpointState
): Promise<"active" | "paused" | "cancelled"> {
  const task = await repos.getTask(taskId);
  if (!task || task.status === "cancelled") return "cancelled";
  if (task.status === "running" && task.pauseRequestedAt) {
    await repos.landTaskPause({ taskId, userId, state: checkpoint });
    return "paused";
  }
  if (task.status === "paused") return "paused";
  return "active";
}
