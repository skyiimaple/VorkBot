import { describe, expect, it, vi } from "vitest";
import type { RoutineDispatch } from "@vork/database";
import { publishRoutineDispatch } from "./routine-publication.js";

const dispatch = {
  run: {
    id: "routine_run_1",
    routineId: "routine_1",
    userId: "user_local",
    scheduledFor: "2026-09-30T01:00:00.000Z",
    claimedAt: "2026-09-30T01:00:00.000Z",
    taskId: "task_1",
    status: "queued",
    missedCount: 0,
    errorCode: null,
    createdAt: "2026-09-30T01:00:00.000Z",
    updatedAt: "2026-09-30T01:00:00.000Z"
  },
  taskJob: {
    taskId: "task_1",
    userId: "user_local",
    botId: "bot_1",
    conversationId: "conversation_1",
    messageId: "message_1"
  }
} satisfies RoutineDispatch;

describe("routine publication", () => {
  it("publishes with a stable routine run job id", async () => {
    const publish = vi.fn(async () => undefined);
    const markRoutinePublicationFailed = vi.fn(async () => dispatch.run);
    await publishRoutineDispatch(dispatch, { publish }, { markRoutinePublicationFailed });
    expect(publish).toHaveBeenCalledWith(dispatch.taskJob, { jobId: "routine-run-routine_run_1" });
    expect(markRoutinePublicationFailed).not.toHaveBeenCalled();
  });

  it("does not publish skipped runs", async () => {
    const publish = vi.fn(async () => undefined);
    const markRoutinePublicationFailed = vi.fn(async () => dispatch.run);
    await publishRoutineDispatch({ ...dispatch, taskJob: null }, { publish }, { markRoutinePublicationFailed });
    expect(publish).not.toHaveBeenCalled();
  });

  it("converges queue failures without creating a second task", async () => {
    const publish = vi.fn(async () => { throw new Error("redis unavailable"); });
    const markRoutinePublicationFailed = vi.fn(async () => ({ ...dispatch.run, status: "publication_failed" as const }));
    await expect(publishRoutineDispatch(dispatch, { publish }, { markRoutinePublicationFailed }))
      .rejects.toThrow("ROUTINE_PUBLICATION_FAILED");
    expect(markRoutinePublicationFailed).toHaveBeenCalledWith(dispatch.run.id, "ROUTINE_PUBLICATION_FAILED");
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
