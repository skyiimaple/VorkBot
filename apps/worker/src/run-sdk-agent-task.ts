import type { TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { AgentComputerClientLike } from "./computer-client.js";
import type { TaskNotifier } from "./queue.js";
import type { SdkRuntimeLike } from "./agents-sdk-runtime.js";
import type { SdkItem } from "./agents-sdk-boundary.js";
import { createAgentsComputerExecutor } from "./agents-computer-executor.js";
import { createTaskControlMonitor, honorTaskControl } from "./task-control.js";
import { riskForToolAction, UncertainSideEffectError } from "./tool-executor.js";

const stopped = new Set(["completed", "failed", "cancelled", "paused", "uncertain"]);
type Dependencies = {
  repos: Repositories; runtime: SdkRuntimeLike; notifier: TaskNotifier;
  computer?: AgentComputerClientLike; resumeRunning?: boolean;
};

export async function runSdkAgentTask(job: TaskJob, deps: Dependencies): Promise<void> {
  const task = await deps.repos.getTask(job.taskId);
  if (!task || stopped.has(task.status) || task.status === "waiting_approval" || (task.status === "running" && !deps.resumeRunning)) return;
  const monitor = createTaskControlMonitor(deps.repos, task.id);
  const notify = () => deps.notifier.notify(task.id).catch(() => {});
  let executor: ReturnType<typeof createAgentsComputerExecutor> | undefined;
  try {
    if (task.status !== "running") await deps.repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    await notify();
    const [saved, messages, bot, previous, checkpoint, approved] = await Promise.all([
      deps.repos.getSdkAgentRun(task.id, task.userId),
      deps.repos.listMessages({ userId: task.userId, conversationId: task.conversationId }),
      deps.repos.getBot({ userId: task.userId, botId: task.botId }),
      deps.repos.getSdkConversationHistory({ taskId: task.id, userId: task.userId, conversationId: task.conversationId }),
      deps.repos.getLatestTaskCheckpoint(task.id, task.userId),
      deps.repos.getApprovedSdkAction(task.id, task.userId)
    ]);
    const userIndex = messages.findIndex((message) => message.id === task.messageId);
    if (userIndex < 0) throw new Error("SDK_USER_MESSAGE_MISSING");
    const previousIndex = previous ? messages.findIndex((message) => message.id === previous.messageId) : -1;
    const history: SdkItem[] = previous && previousIndex >= 0
      ? [...previous.history as SdkItem[], ...messages.slice(previousIndex + 1, userIndex + 1).filter((message) => message.authorType === "user").map((message) => ({ role: "user", content: message.content }))]
      : messages.slice(0, userIndex + 1).map((message) => message.authorType === "user"
        ? { role: "user", content: message.content }
        : { role: "assistant", status: "completed", content: [{ type: "output_text", text: message.content }] });
    executor = deps.computer ? createAgentsComputerExecutor({ task, computer: deps.computer, repos: deps.repos, notifier: deps.notifier, initialTurn: Math.max(0, (checkpoint?.state.nextTurn ?? 1) - 1) }) : undefined;
    const result = await deps.runtime.runTurn({
      name: `Vork-${task.botId}`,
      instructions: bot?.persona || "你是可靠、主动、简洁的个人助手 Vork。",
      input: history,
      state: saved?.state,
      approveCallId: approved?.callId,
      signal: AbortSignal.any([monitor.signal, AbortSignal.timeout(300_000)]),
      onApprovalApplied: async (callId) => {
        if (!approved || approved.callId !== callId) throw new Error("SDK_APPROVAL_CALL_MISMATCH");
        await deps.repos.markSdkApprovalApplied(approved.id, task.userId);
      },
      onState: async (state) => {
        await deps.repos.saveSdkAgentRun({ taskId: task.id, userId: task.userId, state });
        const latestCheckpoint = await deps.repos.getLatestTaskCheckpoint(task.id, task.userId);
        const control = await honorTaskControl(deps.repos, task.id, task.userId, latestCheckpoint?.state ?? { nextTurn: 1, lastObservation: "", reply: "", modelTurns: 0, toolCalls: 0, lastCompletedToolCallId: null });
        if (control !== "active") throw new Error(`SDK_TASK_${control.toUpperCase()}`);
      },
      onToolCall: async (action, callId) => {
        const latest = await deps.repos.getTask(task.id);
        if (!latest || latest.status !== "running") throw new Error("SDK_TASK_STOPPED");
        if (!executor) throw new Error("COMPUTER_UNAVAILABLE");
        const call = await deps.repos.prepareSdkToolCall({ taskId: task.id, userId: task.userId, callId, action, risk: riskForToolAction(action) });
        if (call.status === "executing" && call.risk === "side_effect") {
          await deps.repos.markToolCallUncertain(call.id, task.userId);
          await notify();
          throw new UncertainSideEffectError(call.id);
        }
        return executor.execute(action, { approved: true, existingToolCall: call });
      },
      onDelta: async (text) => {
        const latest = await deps.repos.getTask(task.id);
        if (!latest || latest.status !== "running") throw new Error("SDK_TASK_STOPPED");
        await deps.repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { text } });
        await notify();
      }
    });
    const latest = await deps.repos.getTask(task.id);
    if (!latest || latest.status !== "running") return;
    await deps.repos.saveSdkAgentRun({ taskId: task.id, userId: task.userId, state: result.state, ...(!result.approval ? { history: result.history } : {}) });
    if (result.approval) {
      await deps.repos.requestApproval({ taskId: task.id, reason: result.approval.reason, action: { ...result.approval.action, sdkCallId: result.approval.callId } });
    } else {
      await deps.repos.completeTaskWithMessage({ taskId: task.id, content: result.reply });
    }
    await notify();
  } catch (error) {
    const latest = await deps.repos.getTask(task.id);
    if (!latest || stopped.has(latest.status) || latest.status === "waiting_approval") return;
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    const code = status === 401 ? "MODEL_AUTH_FAILED" : status === 402 || status === 429 ? "MODEL_QUOTA_EXCEEDED" : "SDK_MODEL_UNAVAILABLE";
    const content = status === 401 ? "模型密钥无效，请检查模型设置。" : status === 402 || status === 429 ? "模型余额不足或请求受限，请检查模型服务的余额与用量。" : "本次任务执行失败，已有进度已保存。请检查模型及电脑连接后重试。";
    await deps.repos.failTaskWithMessage({ taskId: task.id, errorCode: code, content });
    await notify();
  } finally {
    monitor.stop();
    await executor?.close().catch(() => {});
  }
}
