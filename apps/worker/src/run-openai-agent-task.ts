import type { Task, TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { OpenAIAgentsRuntime, OpenAIAgentsTurnInput, OpenAIAgentRuntimeError } from "./openai-agents-runtime.js";
import type { TaskNotifier } from "./queue.js";
import type { AgentComputerClientLike } from "./computer-client.js";
import {
  AgentsComputerExecutionError,
  createAgentsComputerExecutor
} from "./agents-computer-executor.js";

const terminalStatuses = new Set<Task["status"]>(["completed", "failed", "cancelled"]);

export type AgentsRuntimeLike = Pick<OpenAIAgentsRuntime, "runTurn">;

type RunOpenAIAgentTaskDependencies = {
  repos: Repositories;
  runtime?: AgentsRuntimeLike;
  notifier: TaskNotifier;
  computer?: AgentComputerClientLike;
};

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // PostgreSQL task_events remains the source of truth.
  }
}

function runtimeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 64);
  }
  return "OPENAI_AGENTS_UNAVAILABLE";
}

export async function runOpenAIAgentTask(
  job: TaskJob,
  deps: RunOpenAIAgentTaskDependencies
): Promise<void> {
  const task = await deps.repos.getTask(job.taskId);
  if (!task || terminalStatuses.has(task.status) || task.status === "running") return;

  if (!deps.runtime) {
    await deps.repos.failTask(task.id, "OPENAI_AGENTS_NOT_CONFIGURED");
    await notify(deps.notifier, task.id);
    return;
  }

  const priorCheckpoint = deps.computer
    ? await deps.repos.getLatestTaskCheckpoint(task.id, task.userId)
    : null;
  const computerExecutor = deps.computer
    ? createAgentsComputerExecutor({
        task,
        computer: deps.computer,
        repos: deps.repos,
        notifier: deps.notifier,
        initialTurn: Math.max(0, (priorCheckpoint?.state.nextTurn ?? 1) - 1)
      })
    : undefined;

  try {
    try {
      await deps.repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    } catch (error) {
      const claimed = await deps.repos.getTask(task.id);
      if (!claimed || claimed.status === "running" || terminalStatuses.has(claimed.status)) return;
      throw error;
    }
    await notify(deps.notifier, task.id);

    const [messages, bot, mapping] = await Promise.all([
      deps.repos.listMessages({ userId: task.userId, conversationId: task.conversationId }),
      deps.repos.getBot({ userId: task.userId, botId: task.botId }),
      deps.repos.getAgentSession({
        userId: task.userId,
        conversationId: task.conversationId,
        runtime: "openai-agents"
      })
    ]);
    const userMessage = messages.find((message) => message.id === task.messageId && message.authorType === "user");
    if (!userMessage) throw new Error("Task user message is unavailable");
    const resumeObservation = await computerExecutor?.resumeApprovedAction();

    const turn: OpenAIAgentsTurnInput = {
      sessionId: mapping?.externalSessionId,
      input: resumeObservation
        ? `用户已批准先前请求的操作。Vork Computer 已执行完成，结果如下：\n${resumeObservation}\n请基于结果继续完成原任务。`
        : userMessage.content,
      instructions: bot?.persona || "你是 Vork，一个可靠、主动且简洁的个人助手。",
      onSessionCreated: async (externalSessionId) => {
        await deps.repos.upsertAgentSession({
          userId: task.userId,
          botId: task.botId,
          conversationId: task.conversationId,
          runtime: "openai-agents",
          externalSessionId
        });
      },
      onToolCall: async (action) => {
        if (!computerExecutor) throw new AgentsComputerExecutionError("COMPUTER_UNAVAILABLE");
        return computerExecutor.execute(action);
      },
      onDelta: async (delta) => {
        if (!delta) return;
        const latest = await deps.repos.getTask(task.id);
        if (!latest || terminalStatuses.has(latest.status)) throw new Error("VORK_TASK_STOPPED");
        await deps.repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { text: delta } });
        await notify(deps.notifier, task.id);
      }
    };
    const result = await deps.runtime.runTurn(turn);

    const latest = await deps.repos.getTask(task.id);
    if (!latest || terminalStatuses.has(latest.status)) return;

    await deps.repos.upsertAgentSession({
      userId: task.userId,
      botId: task.botId,
      conversationId: task.conversationId,
      runtime: "openai-agents",
      externalSessionId: result.sessionId
    });
    if (latest.status === "waiting_approval") return;
    await deps.repos.completeTaskWithMessage({ taskId: task.id, content: result.reply });
    await notify(deps.notifier, task.id);
  } catch (error) {
    const latest = await deps.repos.getTask(task.id);
    if (!latest || terminalStatuses.has(latest.status) || latest.status === "waiting_approval") return;
    try {
      await deps.repos.failTask(task.id, runtimeErrorCode(error as OpenAIAgentRuntimeError));
      await notify(deps.notifier, task.id);
    } catch {
      // A concurrent terminal transition wins.
    }
  } finally {
    await computerExecutor?.close().catch(() => {});
  }
}
