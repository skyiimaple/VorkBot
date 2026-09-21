import {
  CreateQueuedMessageTaskInputSchema,
  QueuedMessageTaskResultSchema,
  TaskJobSchema,
  TaskPublicationFailureResponseSchema,
  TaskSchema,
  type TaskJob
} from "@vork/contracts";
import type { Repositories } from "@vork/database";

export type TaskQueue = {
  publish(job: TaskJob, options?: { jobId?: string }): Promise<unknown>;
};

export type SubmitMessageResult =
  | { kind: "queued"; message: ReturnType<typeof QueuedMessageTaskResultSchema.parse>["message"]; task: ReturnType<typeof QueuedMessageTaskResultSchema.parse>["task"] }
  | { kind: "publication_failed"; response: ReturnType<typeof TaskPublicationFailureResponseSchema.parse> };

export class ChatService {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: TaskQueue
  ) {}

  async submitMessage(rawInput: unknown): Promise<SubmitMessageResult> {
    const input = CreateQueuedMessageTaskInputSchema.parse(rawInput);
    const queued = QueuedMessageTaskResultSchema.parse(await this.repositories.createQueuedMessageTask(input));
    const job = TaskJobSchema.parse({
      taskId: queued.task.id,
      userId: input.userId,
      botId: input.botId,
      conversationId: input.conversationId,
      messageId: queued.message.id
    });

    try {
      await this.queue.publish(job);
    } catch {
      const task = TaskSchema.parse(await this.repositories.failTask(queued.task.id, "TASK_PUBLICATION_FAILED"));
      return {
        kind: "publication_failed",
        response: TaskPublicationFailureResponseSchema.parse({
          error: { code: "TASK_PUBLICATION_FAILED" },
          task
        })
      };
    }

    return {
      kind: "queued",
      message: queued.message,
      task: TaskSchema.parse(queued.task)
    };
  }
}
