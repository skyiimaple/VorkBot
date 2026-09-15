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
    // Redis only wakes live consumers; durable task events remain the source of truth.
  }
}

export async function runChatTask(rawJob: TaskJob, deps: RunChatTaskDependencies): Promise<void> {
  const job = TaskJobSchema.parse(rawJob);
  const task = await deps.repos.getTask(job.taskId);
  if (!task || terminalStatuses.has(task.status) || task.status === "running") return;

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

    let reply = "";
    for await (const delta of deps.model.streamReply({
      botId: task.botId,
      conversationId: task.conversationId,
      userMessage: userMessage.content
    })) {
      reply += delta;
      await deps.repos.appendTaskEvent({ taskId: task.id, type: "message.delta", payload: { text: delta } });
      await notify(deps.notifier, task.id);
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
      // A concurrent worker may have reached a terminal state while handling this job.
    }
  }
}
