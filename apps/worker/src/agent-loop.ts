import {
  AGENT_EVENT_TYPES,
  AgentActionSchema,
  DEFAULT_TASK_BUDGET,
  SLOT_EVENT_TYPES,
  TOOL_EVENT_TYPES,
  type AgentAction,
  type Task,
  type TaskBudget,
  type TaskJob
} from "@vork/contracts";
import type { Job } from "bullmq";
import type { Repositories } from "@vork/database";
import { BudgetExceededError, createBudgetTracker } from "./budget.js";
import { appendToolFailed, failComputerTask } from "./computer-task-errors.js";
import type { ComputerClientLike } from "./computer-client.js";
import {
  createAgentFileDemoActions,
  FakeActionModel,
  type ActionModel
} from "./fake-action-model.js";
import { evaluateActionPolicy } from "./policy.js";
import { shouldSuggestSkillDraft, workingMemorySummary } from "./phase3-helpers.js";
import type { TaskNotifier } from "./queue.js";
import { retryOrFailSlotWait, toSlotWaitError } from "./slot-retry.js";
import { assertTaskStillActive } from "./task-guard.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const terminalStatuses = new Set<Task["status"]>(["completed", "failed", "cancelled"]);

export type AgentLoopDependencies = {
  repos: Repositories;
  computer: ComputerClientLike;
  notifier: TaskNotifier;
  job?: Job<TaskJob>;
  actionModel?: ActionModel;
  budget?: TaskBudget;
};

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Redis 只唤醒在线消费者。
  }
}

function isToolAction(action: AgentAction): boolean {
  return action.type === "file.write" || action.type === "file.read";
}

export async function runAgentLoop(rawJob: TaskJob, deps: AgentLoopDependencies): Promise<void> {
  const task = await deps.repos.getTask(rawJob.taskId);
  if (!task || terminalStatuses.has(task.status)) return;
  if (task.status === "waiting_approval") return;

  const budget = deps.budget ?? DEFAULT_TASK_BUDGET;
  const tracker = createBudgetTracker(budget);
  const startedAt = Date.now();
  const actionModel = deps.actionModel ?? new FakeActionModel(createAgentFileDemoActions());

  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let activeTool: string | undefined;
  let reply = "";
  let lastObservation: string | undefined;
  let turn = 0;

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

    const messages = await deps.repos.listMessages({
      userId: task.userId,
      conversationId: task.conversationId
    });
    const userMessage = messages.find((m) => m.id === task.messageId && m.authorType === "user");
    if (!userMessage) throw new Error("Task user message is unavailable");

    const resume = await deps.repos.claimApprovedActionForResume(task.id);
    if (resume) {
      const approvedAction = AgentActionSchema.parse(resume.action);
      await deps.repos.appendTaskEvent({
        taskId: task.id,
        type: AGENT_EVENT_TYPES.ACTION,
        payload: { actionType: approvedAction.type, turn: turn + 1, resumed: true, approvalId: resume.id }
      });
      await notify(deps.notifier, task.id);

      if (approvedAction.type === "memory.propose") {
        await deps.repos.insertMemory({
          userId: task.userId,
          botId: task.botId,
          kind: approvedAction.kind,
          content: approvedAction.content,
          sensitivity: approvedAction.sensitivity,
          sourceTaskId: task.id
        });
        lastObservation = `saved ${approvedAction.kind} memory`;
      } else if (isToolAction(approvedAction)) {
        tracker.recordToolCall();
        tracker.assertWithinBudget(startedAt);
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;
        activeTool = approvedAction.type;
        lastObservation = await executeToolAction(approvedAction, {
          taskId: task.id,
          leaseId: lease.leaseId,
          computer: deps.computer,
          repos: deps.repos,
          notifier: deps.notifier
        });
        activeTool = undefined;
      }
    }

    while (true) {
      if (!(await assertTaskStillActive(deps.repos, task.id))) return;
      tracker.assertWithinBudget(startedAt);

      tracker.recordModelTurn();
      turn += 1;
      tracker.assertWithinBudget(startedAt);

      const rawAction = await actionModel.nextAction({
        botId: task.botId,
        conversationId: task.conversationId,
        userMessage: userMessage.content,
        turn,
        lastObservation
      });
      const action = AgentActionSchema.parse(rawAction);

      await deps.repos.appendTaskEvent({
        taskId: task.id,
        type: AGENT_EVENT_TYPES.ACTION,
        payload: { actionType: action.type, turn }
      });
      await notify(deps.notifier, task.id);

      const policy = evaluateActionPolicy(action);
      if (policy.decision === "deny") {
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;
        await deps.repos.failTask(task.id, "POLICY_DENIED");
        await notify(deps.notifier, task.id);
        return;
      }
      if (policy.decision === "needs_approval") {
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;
        await deps.repos.requestApproval({ taskId: task.id, reason: policy.reason, action });
        await notify(deps.notifier, task.id);
        return;
      }

      if (action.type === "task.complete") {
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;
        const content = reply.trim() || "任务已完成。";
        await deps.repos.compressWorkingMemory({
          userId: task.userId,
          botId: task.botId,
          taskId: task.id,
          content: workingMemorySummary(content)
        });
        const priorCompleted = await deps.repos.countCompletedTasks(task.botId);
        if (shouldSuggestSkillDraft(priorCompleted)) {
          await deps.repos.appendTaskEvent({
            taskId: task.id,
            type: "skill.suggest",
            payload: { reason: "repeated_success" }
          });
        }
        await deps.repos.completeTaskWithMessage({ taskId: task.id, content });
        await notify(deps.notifier, task.id);
        return;
      }

      if (action.type === "task.fail") {
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;
        await deps.repos.failTask(task.id, action.errorCode);
        await notify(deps.notifier, task.id);
        return;
      }

      if (action.type === "message.reply") {
        reply = action.text;
        for (const chunk of chunkText(action.text, 24)) {
          if (!(await assertTaskStillActive(deps.repos, task.id))) return;
          await deps.repos.appendTaskEvent({
            taskId: task.id,
            type: "message.delta",
            payload: { text: chunk }
          });
          await notify(deps.notifier, task.id);
        }
        continue;
      }

      if (action.type === "memory.propose") {
        await deps.repos.insertMemory({
          userId: task.userId,
          botId: task.botId,
          kind: action.kind,
          content: action.content,
          sensitivity: action.sensitivity,
          sourceTaskId: task.id
        });
        lastObservation = `saved ${action.kind} memory`;
        continue;
      }

      if (isToolAction(action)) {
        tracker.recordToolCall();
        tracker.assertWithinBudget(startedAt);
        if (!(await assertTaskStillActive(deps.repos, task.id))) return;

        activeTool = action.type;
        lastObservation = await executeToolAction(action, {
          taskId: task.id,
          leaseId: lease.leaseId,
          computer: deps.computer,
          repos: deps.repos,
          notifier: deps.notifier
        });
        activeTool = undefined;
        continue;
      }
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      const latest = await deps.repos.getTask(task.id);
      if (latest && !terminalStatuses.has(latest.status)) {
        await deps.repos.appendTaskEvent({
          taskId: task.id,
          type: AGENT_EVENT_TYPES.BUDGET_EXCEEDED,
          payload: {
            reason: error.reason,
            budget: error.budget,
            modelTurns: error.modelTurns,
            toolCalls: error.toolCalls,
            elapsedMs: error.elapsedMs
          }
        });
        await deps.repos.failTask(task.id, "BUDGET_EXCEEDED");
        await notify(deps.notifier, task.id);
      }
      return;
    }

    if (activeTool) {
      await appendToolFailed(task.id, activeTool, error, { repos: deps.repos, notifier: deps.notifier });
    }
    await failComputerTask(task.id, error, { repos: deps.repos, notifier: deps.notifier });
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (leaseId) {
      try {
        await deps.computer.release(leaseId);
        const latest = await deps.repos.getTask(task.id);
        if (latest) {
          await deps.repos.appendTaskEvent({
            taskId: task.id,
            type: SLOT_EVENT_TYPES.RELEASED,
            payload: { leaseId }
          });
          await notify(deps.notifier, task.id);
        }
      } catch {
        // best-effort release
      }
    }
  }
}

async function executeToolAction(
  action: Extract<AgentAction, { type: "file.write" | "file.read" }>,
  deps: {
    taskId: string;
    leaseId: string;
    computer: ComputerClientLike;
    repos: Repositories;
    notifier: TaskNotifier;
  }
): Promise<string> {
  await deps.repos.appendTaskEvent({
    taskId: deps.taskId,
    type: TOOL_EVENT_TYPES.STARTED,
    payload: { toolName: action.type, path: action.path }
  });
  await notify(deps.notifier, deps.taskId);

  if (action.type === "file.write") {
    const written = await deps.computer.writeFile(deps.leaseId, action.path, action.content);
    const observation = `wrote ${written.path} (${written.bytes} bytes)`;
    await deps.repos.appendTaskEvent({
      taskId: deps.taskId,
      type: TOOL_EVENT_TYPES.FINISHED,
      payload: { toolName: action.type, path: written.path, bytes: written.bytes }
    });
    await notify(deps.notifier, deps.taskId);
    return observation;
  }

  const read = await deps.computer.readFile(deps.leaseId, action.path);
  const observation = `read ${read.path}: ${read.content.slice(0, 500)}${read.truncated ? "…" : ""}`;
  await deps.repos.appendTaskEvent({
    taskId: deps.taskId,
    type: TOOL_EVENT_TYPES.FINISHED,
    payload: {
      toolName: action.type,
      path: read.path,
      bytes: read.content.length,
      truncated: read.truncated
    }
  });
  await notify(deps.notifier, deps.taskId);
  return observation;
}

function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
