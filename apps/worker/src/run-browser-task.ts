import {
  SLOT_EVENT_TYPES,
  TOOL_EVENT_TYPES,
  type TaskJob
} from "@vork/contracts";
import type { Job } from "bullmq";
import type { Repositories } from "@vork/database";
import type { ComputerClientLike, ObserveResult } from "./computer-client.js";
import { appendToolFailed, failComputerTask } from "./computer-task-errors.js";
import type { TaskNotifier } from "./queue.js";
import { retryOrFailSlotWait, toSlotWaitError } from "./slot-retry.js";
import { assertTaskStillActive } from "./task-guard.js";

const BROWSER_DEMO_MARKER = "[browser-demo]";
const DEMO_TEST_PAGE_URL = "file:///app/public/test-page/index.html";
const DEMO_TYPE_TEXT = "hello from vork";
const DEMO_BUTTON_TEST_ID = "demo-action";
const DEMO_INPUT_TEST_ID = "demo-input";
const HEARTBEAT_INTERVAL_MS = 15_000;

type RunBrowserTaskDependencies = {
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

export function isBrowserDemoMessage(content: string): boolean {
  return content.includes(BROWSER_DEMO_MARKER);
}

function findElement(
  observed: ObserveResult,
  matchers: Array<(element: ObserveResult["elements"][number]) => boolean>
): string {
  for (const matcher of matchers) {
    const element = observed.elements.find(matcher);
    if (element) {
      return element.ref;
    }
  }
  throw new Error("element_not_found");
}

export async function runBrowserTask(rawJob: TaskJob, deps: RunBrowserTaskDependencies): Promise<void> {
  const task = await deps.repos.getTask(rawJob.taskId);
  if (!task || terminalStatuses.has(task.status)) return;

  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let activeTool: string | undefined;

  try {
    let lease;
    try {
      lease = await deps.computer.acquire({ taskId: task.id, botId: task.botId, kind: "browser" });
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
    activeTool = "browser.navigate";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool, reason: DEMO_TEST_PAGE_URL }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.navigate(lease.leaseId, DEMO_TEST_PAGE_URL);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: activeTool, reason: DEMO_TEST_PAGE_URL }
    });
    await notify(deps.notifier, task.id);
    activeTool = undefined;

    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    activeTool = "browser.observe";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool }
    });
    await notify(deps.notifier, task.id);
    const observed = await deps.computer.observe(lease.leaseId);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: activeTool, reason: observed.title }
    });
    await notify(deps.notifier, task.id);
    activeTool = undefined;

    const buttonRef = findElement(observed, [
      (element) => element.testId === DEMO_BUTTON_TEST_ID,
      (element) => element.tag === "button" || element.role === "button"
    ]);
    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    activeTool = "browser.click";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool, reason: buttonRef }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.click(lease.leaseId, buttonRef);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: activeTool, reason: buttonRef }
    });
    await notify(deps.notifier, task.id);
    activeTool = undefined;

    const inputRef = findElement(observed, [
      (element) => element.testId === DEMO_INPUT_TEST_ID,
      (element) => element.tag === "input"
    ]);
    if (!(await assertTaskStillActive(deps.repos, task.id))) return;
    activeTool = "browser.type";
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: activeTool, reason: inputRef }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.type(lease.leaseId, inputRef, DEMO_TYPE_TEXT);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: activeTool, reason: inputRef }
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

    await deps.repos.completeTaskWithMessage({
      taskId: task.id,
      content: `浏览器演示完成：已打开测试页「${observed.title}」，点击按钮并在输入框输入「${DEMO_TYPE_TEXT}」。`
    });
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
