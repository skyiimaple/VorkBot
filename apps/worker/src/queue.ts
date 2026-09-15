import { Worker, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";
import { TaskJobSchema, type TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { ModelProvider } from "./model.js";
import { runChatTask } from "./run-chat-task.js";

export const TASK_QUEUE_NAME = "tasks";
export const TASK_JOB_NAME = "execute-task";

export function taskEventChannel(taskId: string): string {
  return `vork:tasks:${taskId}:events`;
}

export type TaskNotifier = {
  notify(taskId: string): Promise<void>;
};

export class RedisTaskNotifier implements TaskNotifier {
  constructor(private readonly publisher: Redis) {}

  async notify(taskId: string): Promise<void> {
    await this.publisher.publish(taskEventChannel(taskId), JSON.stringify({ taskId }));
  }
}

export function createTaskWorker(
  deps: { repos: Repositories; model: ModelProvider; notifier: TaskNotifier },
  connection: ConnectionOptions
): Worker<TaskJob, void, typeof TASK_JOB_NAME> {
  return new Worker<TaskJob, void, typeof TASK_JOB_NAME>(
    TASK_QUEUE_NAME,
    async (job) => runChatTask(TaskJobSchema.parse(job.data), deps),
    { connection }
  );
}
