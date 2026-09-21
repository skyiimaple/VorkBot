import { TaskJobSchema, type Task, type TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { ModelProvider } from "./model.js";
import type { TaskNotifier } from "./queue.js";

const terminalStatuses = new Set<Task["status"]>(["completed", "failed", "cancelled"]);

type RunChatTaskDependencies = {
  repos: Repositories;
  model: ModelProvider;
  notifier: TaskNotifier;
};

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Redis 只唤醒在线消费者；持久化的 task_events 仍是真相来源。
  }
}

export async function runChatTask(rawJob: TaskJob, deps: RunChatTaskDependencies): Promise<void> {
  const job = TaskJobSchema.parse(rawJob);
  const task = await deps.repos.getTask(job.taskId);
  if (!task || terminalStatuses.has(task.status) || task.status === "running") return;

  const abortController = new AbortController();

  try {
    try {
      await deps.repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
    } catch (error) {
      const claimedTask = await deps.repos.getTask(task.id);
      if (!claimedTask || claimedTask.status === "running" || terminalStatuses.has(claimedTask.status)) return;
      throw error;
    }
    await notify(deps.notifier, task.id);

    const messages = await deps.repos.listMessages({ userId: task.userId, conversationId: task.conversationId });
    const userMessage = messages.find((message) => message.id === task.messageId && message.authorType === "user");
    if (!userMessage) throw new Error("Task user message is unavailable");

    const bot = await deps.repos.getBot({ userId: task.userId, botId: task.botId });
    const history = messages
      .filter((message) => message.authorType === "user" || message.authorType === "assistant")
      .map((message) => ({
        role: (message.authorType === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: message.content
      }));

    let reply = "";
    try {
      for await (const delta of deps.model.streamReply({
        botId: task.botId,
        conversationId: task.conversationId,
        userMessage: userMessage.content,
        systemPrompt: bot?.persona,
        messages: history,
        signal: abortController.signal
      })) {
        if (!delta) continue;

        const latest = await deps.repos.getTask(task.id);
        if (!latest || terminalStatuses.has(latest.status)) {
          abortController.abort();
          return;
        }

        reply += delta;
        await deps.repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { text: delta } });
        await notify(deps.notifier, task.id);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      const latest = await deps.repos.getTask(task.id);
      if (!latest || terminalStatuses.has(latest.status)) return;
      throw error;
    }

    const latestAfterStream = await deps.repos.getTask(task.id);
    if (!latestAfterStream || terminalStatuses.has(latestAfterStream.status)) return;

    if (!reply.trim()) {
      await deps.repos.failTask(task.id, "MODEL_EMPTY_REPLY");
      await notify(deps.notifier, task.id);
      return;
    }

    await deps.repos.completeTaskWithMessage({ taskId: task.id, content: reply });
    await notify(deps.notifier, task.id);
  } catch {
    const latestTask = await deps.repos.getTask(task.id);
    if (!latestTask || terminalStatuses.has(latestTask.status)) return;

    try {
      await deps.repos.failTask(task.id, "MODEL_UNAVAILABLE");
      await notify(deps.notifier, task.id);
    } catch {
      // 并发 worker 可能已把任务推入终态。
    }
  }
}
