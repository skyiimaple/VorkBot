import {
  SLOT_EVENT_TYPES,
  TOOL_EVENT_TYPES,
  type TaskJob
} from "@vork/contracts";
import type { Job } from "bullmq";
import type { Repositories } from "@vork/database";
import type { ComputerClientLike } from "./computer-client.js";
import { appendToolFailed, failComputerTask } from "./computer-task-errors.js";
import type { TaskNotifier } from "./queue.js";
import { retryOrFailSlotWait, toSlotWaitError } from "./slot-retry.js";
import { assertTaskStillActive } from "./task-guard.js";

const FILE_DEMO_MARKER = "[file-demo]";
const DEMO_WRITE_PATH = "notes/hello.txt";
const DEMO_WRITE_CONTENT = "你好，来自云电脑文件工具。";
const HEARTBEAT_INTERVAL_MS = 15_000;

type RunFileTaskDependencies = {
  repos: Repositories;
  computer: ComputerClientLike;
  notifier: TaskNotifier;
  job?: Job<TaskJob>;
};

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Redis only wakes live consumers; durable task events remain the source of truth.
  }
}

export function isFileDemoMessage(content: string): boolean {
  return content.includes(FILE_DEMO_MARKER);
}

export async function runFileTask(rawJob: TaskJob, deps: RunFileTaskDependencies): Promise<void> {
  const task = await deps.repos.getTask(rawJob.taskId);
  if (!task || terminalStatuses.has(task.status)) return;

  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let activeTool: string | undefined;

  try {
    let lease;
    try {
      lease = await deps.computer.acquire({ taskId: task.id, botId: task.botId, kind: "file" });
    } catch (error) {
      const wait = toSlotWaitError(error);
      if (wait && deps.job) {
        await retryOrFailSlotWait(deps.job, task.id, wait.code, deps);
      }
      throw error;
    }

    leaseId = lease.leaseId;
    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    if (task.status !== "running") {
      await deps.repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
      await notify(deps.notifier, task.id);
    }

    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: SLOT_EVENT_TYPES.ACQUIRED,
      payload: { slotId: lease.slotId, leaseId: lease.leaseId }
    });
    await notify(deps.notifier, task.id);

    heartbeatTimer = setInterval(() => {
      void deps.computer.heartbeat(lease.leaseId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    activeTool = "file.write";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool, path: DEMO_WRITE_PATH }
    });
    await notify(deps.notifier, task.id);

    const written = await deps.computer.writeFile(lease.leaseId, DEMO_WRITE_PATH, DEMO_WRITE_CONTENT);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: activeTool, path: written.path, bytes: written.bytes }
    });
    await notify(deps.notifier, task.id);
    activeTool = undefined;

    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    activeTool = "file.read";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool, path: DEMO_WRITE_PATH }
    });
    await notify(deps.notifier, task.id);

    const read = await deps.computer.readFile(lease.leaseId, DEMO_WRITE_PATH);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: {
        toolName: activeTool,
        path: read.path,
        bytes: read.bytes,
        truncated: read.truncated
      }
    });
    await notify(deps.notifier, task.id);
    activeTool = undefined;

    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    await deps.computer.release(lease.leaseId);
    leaseId = undefined;
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: SLOT_EVENT_TYPES.RELEASED,
      payload: { leaseId: lease.leaseId }
    });
    await notify(deps.notifier, task.id);

    await deps.repos.completeTaskWithMessage({ taskId: task.id, content: read.content });
    await notify(deps.notifier, task.id);
  } catch (error) {
    if (error instanceof Error && (error.name === "DelayedError" || error.message === "slot_wait_exhausted")) {
      throw error;
    }
    const latestTask = await deps.repos.getTask(task.id);
    if (!latestTask || terminalStatuses.has(latestTask.status)) return;
    try {
      if (activeTool) {
        await appendToolFailed(task.id, activeTool, error, deps);
      }
      await failComputerTask(task.id, error, deps);
    } catch {
      // A concurrent worker may have reached a terminal state while handling this job.
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (leaseId) {
      await deps.computer.release(leaseId).catch(() => {});
    }
  }
}
