import { MessageSchema, TaskJobSchema, TaskSchema, type TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import { z } from "zod";

const SubmitMessageInputSchema = z.object({
  userId: z.string().min(1),
  botId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string().trim().min(1)
});

export type TaskQueue = {
  publish(job: TaskJob): Promise<unknown>;
};

export class ChatService {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: TaskQueue
  ) {}

  async submitMessage(rawInput: unknown) {
    const input = SubmitMessageInputSchema.parse(rawInput);
    const queued = await this.repositories.createQueuedMessageTask(input);
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
      await this.repositories.failTask(queued.task.id, "TASK_PUBLICATION_FAILED");
      return {
        message: MessageSchema.parse(queued.message),
        task: TaskSchema.parse((await this.repositories.getTask(queued.task.id))!)
      };
    }

    return {
      message: MessageSchema.parse(queued.message),
      task: TaskSchema.parse(queued.task)
    };
  }
}
