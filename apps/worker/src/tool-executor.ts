import { TOOL_EVENT_TYPES, type AgentToolAction, type CheckpointState, type ToolCall, type ToolCallRisk } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { AgentComputerClientLike } from "./computer-client.js";
import type { TaskNotifier } from "./queue.js";
import { classifyTransientFailure, runWithTransientRetry } from "./transient-retry.js";

const MAX_OBSERVATION_CHARS = 4000;

export type ToolExecutionState = {
  terminalCursors: Map<string, number>;
};

export class UncertainSideEffectError extends Error {
  constructor(readonly toolCallId: string) {
    super("side effect result is uncertain");
    this.name = "UncertainSideEffectError";
  }
}

export function riskForToolAction(action: AgentToolAction): ToolCallRisk {
  return new Set([
    "browser.click", "browser.type", "terminal.start", "terminal.write",
    "file.write", "file.mkdir", "file.move", "file.delete"
  ]).has(action.type) ? "side_effect" : "safe";
}

export function createToolExecutionState(): ToolExecutionState {
  return { terminalCursors: new Map() };
}

export async function executeToolAction(
  action: AgentToolAction,
  deps: {
    taskId: string;
    leaseId: string;
    computer: AgentComputerClientLike;
    repos: Pick<Repositories, "appendTaskEvent" | "prepareToolCall" | "markToolCallExecuting" | "finishToolCallAndCheckpoint" | "markToolCallUncertain" | "scheduleTaskRetry" | "clearTaskRetry">;
    notifier: TaskNotifier;
    state: ToolExecutionState;
    userId?: string;
    turn?: number;
    attempt?: number;
    checkpoint?: (observation: string, toolCallId: string) => CheckpointState;
    existingToolCall?: ToolCall;
  }
): Promise<string> {
  await deps.repos.appendTaskEvent({
    taskId: deps.taskId,
    type: TOOL_EVENT_TYPES.STARTED,
    payload: { toolName: action.type }
  });
  await notify(deps.notifier, deps.taskId);

  const persistent = deps.userId !== undefined && deps.turn !== undefined && deps.checkpoint !== undefined;
  const call = deps.existingToolCall ?? (persistent
    ? await deps.repos.prepareToolCall({
        taskId: deps.taskId,
        userId: deps.userId!,
        turn: deps.turn!,
        ...(deps.attempt === undefined ? {} : { attempt: deps.attempt }),
        action,
        risk: riskForToolAction(action)
      })
    : undefined);
  if (call?.status === "prepared") await deps.repos.markToolCallExecuting(call.id, deps.userId!);

  let observation: string;
  try {
    const risk = riskForToolAction(action);
    observation = truncateObservation(await runWithTransientRetry(
      () => dispatch(action, deps),
      {
        shouldRetry: (error) => classifyTransientFailure(error, "tool", risk, true),
        onRetry: persistent && risk === "safe" ? async (attempt, delayMs) => {
          await deps.repos.scheduleTaskRetry({
            taskId: deps.taskId,
            userId: deps.userId!,
            attempt,
            nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
            errorCode: "COMPUTER_TRANSIENT"
          });
        } : undefined
      }
    ));
    if (persistent) await deps.repos.clearTaskRetry(deps.taskId, deps.userId!);
  } catch (error) {
    if (call && call.risk === "side_effect") {
      await deps.repos.markToolCallUncertain(call.id, deps.userId!);
      throw new UncertainSideEffectError(call.id);
    }
    throw error;
  }

  if (call) {
    await deps.repos.finishToolCallAndCheckpoint({
      toolCallId: call.id,
      userId: deps.userId!,
      observation,
      checkpoint: deps.checkpoint!(observation, call.id)
    });
    await notify(deps.notifier, deps.taskId);
    return observation;
  }

  await deps.repos.appendTaskEvent({
    taskId: deps.taskId,
    type: TOOL_EVENT_TYPES.FINISHED,
    payload: { toolName: action.type }
  });
  await notify(deps.notifier, deps.taskId);
  return observation;
}

async function dispatch(
  action: AgentToolAction,
  deps: { leaseId: string; computer: AgentComputerClientLike; state: ToolExecutionState }
): Promise<string> {
  switch (action.type) {
    case "file.write": {
      const result = await deps.computer.writeFile(deps.leaseId, action.path, action.content);
      return `wrote ${result.path} (${result.bytes} bytes)`;
    }
    case "file.read": {
      const result = await deps.computer.readFile(deps.leaseId, action.path);
      return `read ${result.path}: ${result.content}${result.truncated ? "…" : ""}`;
    }
    case "file.list": {
      const result = await deps.computer.listFiles(deps.leaseId, action.path);
      return `listed ${action.path ?? "."}: ${JSON.stringify(result.entries)}`;
    }
    case "file.stat":
      return `stat ${action.path}: ${JSON.stringify(await deps.computer.statFile(deps.leaseId, action.path))}`;
    case "file.mkdir": {
      const result = await deps.computer.makeDirectory(deps.leaseId, action.path);
      return `created directory ${result.path}`;
    }
    case "file.move": {
      const result = await deps.computer.moveFile(deps.leaseId, action.from, action.to);
      return `moved ${result.from} to ${result.to}`;
    }
    case "file.delete": {
      const result = await deps.computer.deleteFile(deps.leaseId, action.path, action.recursive);
      return `deleted ${result.path}`;
    }
    case "browser.navigate": {
      const result = await deps.computer.navigate(deps.leaseId, action.url);
      return `navigated to ${result.url}`;
    }
    case "browser.observe": {
      const result = await deps.computer.observe(deps.leaseId);
      return `observed ${result.title} (${result.url}): ${JSON.stringify(result.elements)}`;
    }
    case "browser.click": {
      const result = await deps.computer.click(deps.leaseId, action.ref);
      return `clicked ${result.ref}`;
    }
    case "browser.type": {
      const result = await deps.computer.type(deps.leaseId, action.ref, action.text);
      return `typed into ${result.ref}`;
    }
    case "browser.scroll": {
      const result = await deps.computer.scroll(deps.leaseId, action.deltaY);
      return `scrolled ${result.deltaY}`;
    }
    case "terminal.start": {
      const result = await deps.computer.startTerminal(deps.leaseId, action.command);
      deps.state.terminalCursors.set(result.sessionId, 0);
      return `terminal ${result.sessionId} started (${result.status})`;
    }
    case "terminal.write": {
      const result = await deps.computer.writeTerminal(deps.leaseId, action.sessionId, action.input);
      return `wrote terminal ${result.sessionId}`;
    }
    case "terminal.read": {
      const cursor = action.cursor ?? deps.state.terminalCursors.get(action.sessionId) ?? 0;
      const result = await deps.computer.readTerminal(deps.leaseId, action.sessionId, cursor);
      deps.state.terminalCursors.set(action.sessionId, result.nextCursor);
      return `terminal ${result.sessionId} ${result.status}: ${result.output}${result.truncated ? "…" : ""}`;
    }
    case "terminal.terminate": {
      const result = await deps.computer.terminateTerminal(deps.leaseId, action.sessionId);
      deps.state.terminalCursors.delete(action.sessionId);
      return `terminated terminal ${result.sessionId}`;
    }
  }
}

function truncateObservation(observation: string): string {
  return observation.length <= MAX_OBSERVATION_CHARS
    ? observation
    : `${observation.slice(0, MAX_OBSERVATION_CHARS)}…`;
}

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Durable task events remain authoritative when the wake-up channel is unavailable.
  }
}
