import {
  SLOT_EVENT_TYPES,
  TOOL_EVENT_TYPES,
  type TaskJob
} from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { ComputerClientLike, ObserveResult } from "./computer-client.js";
import type { TaskNotifier } from "./queue.js";

const BROWSER_DEMO_MARKER = "[browser-demo]";
const DEMO_TEST_PAGE_URL = "file:///app/public/test-page/index.html";
const DEMO_TYPE_TEXT = "hello from vork";
const HEARTBEAT_INTERVAL_MS = 15_000;

type RunBrowserTaskDependencies = {
  repos: Repositories;
  computer: ComputerClientLike;
  notifier: TaskNotifier;
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

function findElement(observed: ObserveResult, matcher: (element: ObserveResult["elements"][number]) => boolean): string {
  const element = observed.elements.find(matcher);
  if (!element) {
    throw new Error("element_not_found");
  }
  return element.ref;
}

export async function runBrowserTask(rawJob: TaskJob, deps: RunBrowserTaskDependencies): Promise<void> {
  const task = await deps.repos.getTask(rawJob.taskId);
  if (!task || terminalStatuses.has(task.status) || task.status === "running") return;

  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  try {
    await deps.repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await notify(deps.notifier, task.id);

    const lease = await deps.computer.acquire({ taskId: task.id, botId: task.botId, kind: "browser" });
    leaseId = lease.leaseId;
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: SLOT_EVENT_TYPES.ACQUIRED,
      payload: { slotId: lease.slotId, leaseId: lease.leaseId }
    });
    await notify(deps.notifier, task.id);

    heartbeatTimer = setInterval(() => {
      void deps.computer.heartbeat(lease.leaseId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: "browser.navigate", reason: DEMO_TEST_PAGE_URL }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.navigate(lease.leaseId, DEMO_TEST_PAGE_URL);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: "browser.navigate", reason: DEMO_TEST_PAGE_URL }
    });
    await notify(deps.notifier, task.id);

    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: "browser.observe" }
    });
    await notify(deps.notifier, task.id);
    const observed = await deps.computer.observe(lease.leaseId);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: "browser.observe", reason: observed.title }
    });
    await notify(deps.notifier, task.id);

    const buttonRef = findElement(observed, (element) => element.tag === "button" || element.role === "button");
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: "browser.click", reason: buttonRef }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.click(lease.leaseId, buttonRef);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: "browser.click", reason: buttonRef }
    });
    await notify(deps.notifier, task.id);

    const inputRef = findElement(observed, (element) => element.tag === "input");
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolName: "browser.type", reason: inputRef }
    });
    await notify(deps.notifier, task.id);
    await deps.computer.type(lease.leaseId, inputRef, DEMO_TYPE_TEXT);
    await deps.repos.appendTaskEvent({
      taskId: task.id,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: "browser.type", reason: inputRef }
    });
    await notify(deps.notifier, task.id);

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
  } catch {
    const latestTask = await deps.repos.getTask(task.id);
    if (!latestTask || terminalStatuses.has(latestTask.status)) return;
    try {
      await deps.repos.failTask(task.id, "COMPUTER_UNAVAILABLE");
      await notify(deps.notifier, task.id);
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
