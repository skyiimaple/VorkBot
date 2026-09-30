import type { TaskJob } from "@vork/contracts";
import type { Job } from "bullmq";
import type { Repositories } from "@vork/database";
import { createActionModelFromEnv, isAgentLlmMessage } from "./action-model.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentComputerClientLike } from "./computer-client.js";
import { createAgentPauseDemoModel, createAgentTerminalDemoModel, createAgentUncertainDemoModel, isAgentFileMessage, isAgentPauseMessage, isAgentTerminalMessage, isAgentUncertainMessage } from "./fake-action-model.js";
import type { ModelProvider } from "./model.js";
import type { TaskNotifier } from "./queue.js";
import { runChatTask } from "./run-chat-task.js";
import { isBrowserDemoMessage, runBrowserTask } from "./run-browser-task.js";
import { isFileDemoMessage, runFileTask } from "./run-file-task.js";

export type TaskWorkerDependencies = {
  repos: Repositories;
  model: ModelProvider;
  notifier: TaskNotifier;
  computer?: AgentComputerClientLike;
};

const uncertainSimulatedTasks = new Set<string>();

async function notify(notifier: TaskNotifier, taskId: string): Promise<void> {
  try {
    await notifier.notify(taskId);
  } catch {
    // Redis 只唤醒在线消费者；持久化的 task_events 仍是真相来源。
  }
}

async function failWithoutComputer(taskId: string, deps: Pick<TaskWorkerDependencies, "repos" | "notifier">): Promise<void> {
  const task = await deps.repos.getTask(taskId);
  if (!task || task.status === "completed" || task.status === "failed" || task.status === "cancelled") return;
  try {
    await deps.repos.failTask(taskId, "COMPUTER_UNAVAILABLE");
    await notify(deps.notifier, taskId);
  } catch {
    // 并发终态竞争时忽略。
  }
}

export async function runTask(
  job: TaskJob,
  deps: TaskWorkerDependencies,
  queueJob?: Job<TaskJob>
): Promise<void> {
  const task = await deps.repos.getTask(job.taskId);
  if (!task) return;

  const messages = await deps.repos.listMessages({ userId: task.userId, conversationId: task.conversationId });
  const userMessage = messages.find((message) => message.id === task.messageId && message.authorType === "user");
  if (!userMessage) {
    await runChatTask(job, deps);
    return;
  }

  if (isAgentFileMessage(userMessage.content)) {
    if (!deps.computer) {
      await failWithoutComputer(job.taskId, deps);
      return;
    }
    await runAgentLoop(job, {
      repos: deps.repos,
      computer: deps.computer,
      notifier: deps.notifier,
      job: queueJob
    });
    return;
  }

  if (isAgentPauseMessage(userMessage.content)) {
    if (!deps.computer) return failWithoutComputer(job.taskId, deps);
    await runAgentLoop(job, { repos: deps.repos, computer: deps.computer, notifier: deps.notifier, job: queueJob, actionModel: createAgentPauseDemoModel() });
    return;
  }

  if (isAgentUncertainMessage(userMessage.content)) {
    if (!deps.computer) return failWithoutComputer(job.taskId, deps);
    const computer = new Proxy(deps.computer, {
      get(target, property, receiver) {
        if (property === "writeFile") {
          return async (...args: Parameters<AgentComputerClientLike["writeFile"]>) => {
            const result = await target.writeFile(...args);
            if (!uncertainSimulatedTasks.has(job.taskId)) {
              uncertainSimulatedTasks.add(job.taskId);
              throw new Error("simulated response loss after side effect");
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    await runAgentLoop(job, { repos: deps.repos, computer, notifier: deps.notifier, job: queueJob, actionModel: createAgentUncertainDemoModel() });
    return;
  }

  if (isAgentTerminalMessage(userMessage.content)) {
    if (!deps.computer) {
      await failWithoutComputer(job.taskId, deps);
      return;
    }
    await runAgentLoop(job, {
      repos: deps.repos,
      computer: deps.computer,
      notifier: deps.notifier,
      job: queueJob,
      actionModel: createAgentTerminalDemoModel()
    });
    return;
  }

  if (isAgentLlmMessage(userMessage.content)) {
    if (!deps.computer) {
      await failWithoutComputer(job.taskId, deps);
      return;
    }
    const bot = await deps.repos.getBot({ userId: task.userId, botId: task.botId });
    await runAgentLoop(job, {
      repos: deps.repos,
      computer: deps.computer,
      notifier: deps.notifier,
      job: queueJob,
      actionModel: createActionModelFromEnv({ systemPrompt: bot?.persona })
    });
    return;
  }

  if (isFileDemoMessage(userMessage.content)) {
    if (!deps.computer) {
      await failWithoutComputer(job.taskId, deps);
      return;
    }
    await runFileTask(job, { repos: deps.repos, computer: deps.computer, notifier: deps.notifier, job: queueJob });
    return;
  }

  if (isBrowserDemoMessage(userMessage.content)) {
    if (!deps.computer) {
      await failWithoutComputer(job.taskId, deps);
      return;
    }
    await runBrowserTask(job, { repos: deps.repos, computer: deps.computer, notifier: deps.notifier, job: queueJob });
    return;
  }

  await runChatTask(job, deps);
}
