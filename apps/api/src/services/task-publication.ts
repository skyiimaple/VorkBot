import { TaskJobSchema, type Task } from "@vork/contracts";
import type { Repositories } from "@vork/database";
import type { TaskQueue } from "./chat-service.js";

export async function publishRecoverableTask(
  task: Task,
  queue: TaskQueue,
  repositories: Repositories
): Promise<void> {
  try {
    await queue.publish(
      TaskJobSchema.parse({
        taskId: task.id,
        userId: task.userId,
        botId: task.botId,
        conversationId: task.conversationId,
        messageId: task.messageId
      }),
      { jobId: `task:${task.id}:resume` }
    );
  } catch {
    await repositories.failTask(task.id, "TASK_PUBLICATION_FAILED", "任务恢复入队失败。");
    throw new Error("TASK_PUBLICATION_FAILED");
  }
}
