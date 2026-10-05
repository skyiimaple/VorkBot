import {
  SLOT_EVENT_TYPES,
  AgentActionSchema,
  type AgentToolAction,
  type CheckpointState,
  type ToolCall
} from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { AgentComputerClientLike } from "./computer-client.js";
import { evaluateActionPolicy } from "./policy.js";
import type { TaskNotifier } from "./queue.js";
import { createToolExecutionState, executeToolAction } from "./tool-executor.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export class AgentsComputerExecutionError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "AgentsComputerExecutionError";
  }
}

type ExecutorRepositories = Pick<Repositories,
  "appendTaskEvent" | "prepareToolCall" | "markToolCallExecuting" |
  "finishToolCallAndCheckpoint" | "markToolCallUncertain" |
  "scheduleTaskRetry" | "clearTaskRetry" | "requestApproval" |
  "claimApprovedActionForResume"
>;

export type AgentsComputerExecutor = {
  execute(action: AgentToolAction, options?: { approved?: boolean; existingToolCall?: ToolCall }): Promise<string>;
  resumeApprovedAction(): Promise<string | undefined>;
  close(): Promise<void>;
};

export function createAgentsComputerExecutor(deps: {
  task: { id: string; userId: string; botId: string };
  initialTurn?: number;
  computer: AgentComputerClientLike;
  repos: ExecutorRepositories;
  notifier: TaskNotifier;
}): AgentsComputerExecutor {
  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let turn = deps.initialTurn ?? 0;
  const state = createToolExecutionState();

  const notify = async () => {
    try {
      await deps.notifier.notify(deps.task.id);
    } catch {
      // Durable events remain authoritative.
    }
  };

  const ensureLease = async (): Promise<string> => {
    if (leaseId) return leaseId;
    const lease = await deps.computer.acquire({
      taskId: deps.task.id,
      botId: deps.task.botId,
      kind: "agent"
    });
    leaseId = lease.leaseId;
    await deps.repos.appendTaskEvent({
      taskId: deps.task.id,
      type: SLOT_EVENT_TYPES.ACQUIRED,
      payload: { slotId: lease.slotId, leaseId: lease.leaseId }
    });
    await notify();
    heartbeatTimer = setInterval(() => {
      if (leaseId) void deps.computer.heartbeat(leaseId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return lease.leaseId;
  };

  const checkpoint = (nextTurn: number, observation: string, toolCallId: string): CheckpointState => ({
    nextTurn,
    lastObservation: observation,
    reply: "",
    modelTurns: 1,
    toolCalls: nextTurn,
    lastCompletedToolCallId: toolCallId
  });

  const perform = async (action: AgentToolAction, existingToolCall?: ToolCall): Promise<string> => {
    if (existingToolCall?.status === "succeeded") return existingToolCall.observation ?? "工具已执行完成";
    turn = existingToolCall?.turn ?? turn + 1;
    const currentLeaseId = await ensureLease();
    return executeToolAction(action, {
      taskId: deps.task.id,
      leaseId: currentLeaseId,
      computer: deps.computer,
      repos: deps.repos,
      notifier: deps.notifier,
      state,
      userId: deps.task.userId,
      turn,
      existingToolCall,
      checkpoint: (observation, toolCallId) => checkpoint(turn + 1, observation, toolCallId)
    });
  };

  return {
    async execute(action, options) {
      const policy = evaluateActionPolicy(action);
      if (policy.decision === "deny") {
        throw new AgentsComputerExecutionError("POLICY_DENIED", policy.reason);
      }
      if (policy.decision === "needs_approval" && !options?.approved) {
        await deps.repos.requestApproval({
          taskId: deps.task.id,
          reason: policy.reason,
          action
        });
        await notify();
        throw new AgentsComputerExecutionError("APPROVAL_REQUIRED", policy.reason);
      }

      return perform(action, options?.existingToolCall);
    },

    async resumeApprovedAction() {
      const approved = await deps.repos.claimApprovedActionForResume(deps.task.id);
      if (!approved) return undefined;
      const action = AgentActionSchema.parse(approved.action);
      if (
        action.type === "message.reply" || action.type === "task.complete" ||
        action.type === "task.fail" || action.type === "memory.propose"
      ) {
        throw new AgentsComputerExecutionError("INVALID_APPROVED_TOOL_ACTION");
      }
      return perform(action);
    },

    async close() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (!leaseId) return;
      const releasing = leaseId;
      leaseId = undefined;
      await deps.computer.release(releasing);
      await deps.repos.appendTaskEvent({
        taskId: deps.task.id,
        type: SLOT_EVENT_TYPES.RELEASED,
        payload: { leaseId: releasing }
      });
      await notify();
    }
  };
}
