import type { Task } from "@vork/contracts";
import type { Repositories } from "@vork/database";

const terminalStatuses = new Set<Task["status"]>(["completed", "failed", "cancelled"]);

/** 若任务已终态（含取消）则返回 false，调用方应立即返回并释放租约。 */
export async function assertTaskStillActive(repos: Repositories, taskId: string): Promise<boolean> {
  const latest = await repos.getTask(taskId);
  return Boolean(latest && !terminalStatuses.has(latest.status));
}
