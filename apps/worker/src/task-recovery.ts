import { TaskJobSchema, type TaskJob } from "@vork/contracts";
import type { Repositories } from "@vork/database";

export type RecoveryQueue = {
  publish(job: TaskJob, options: { jobId: string }): Promise<unknown>;
};

export async function recoverTasksOnStartup(
  queue: RecoveryQueue,
  repos: Pick<Repositories, "listRecoverableTasks" | "markToolCallUncertain">
): Promise<void> {
  const recoverable = await repos.listRecoverableTasks();
  for (const { task, incompleteToolCall } of recoverable) {
    if (incompleteToolCall?.status === "executing" && incompleteToolCall.risk === "side_effect") {
      await repos.markToolCallUncertain(incompleteToolCall.id, task.userId);
      continue;
    }
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
  }
}
