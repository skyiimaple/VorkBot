import { describe, expect, it, vi } from "vitest";
import { recoverTasksOnStartup } from "./task-recovery.js";

describe("worker startup recovery", () => {
  it("requeues safe work with stable ids and marks executing side effects uncertain", async () => {
    const safeTask = { id: "safe", userId: "u", botId: "b", conversationId: "c", messageId: "m", status: "queued" };
    const riskyTask = { ...safeTask, id: "risky", status: "running" };
    const repos = {
      listRecoverableTasks: vi.fn(async () => [
        { task: safeTask, incompleteToolCall: null },
        { task: riskyTask, incompleteToolCall: { id: "tool_1", risk: "side_effect", status: "executing" } }
      ]),
      markToolCallUncertain: vi.fn(async () => riskyTask)
    };
    const queue = { publish: vi.fn(async () => undefined) };
    await recoverTasksOnStartup(queue as never, repos as never);
    expect(queue.publish).toHaveBeenCalledWith(expect.objectContaining({ taskId: "safe" }), { jobId: "task:safe:resume" });
    expect(repos.markToolCallUncertain).toHaveBeenCalledWith("tool_1", "u");
  });
});
