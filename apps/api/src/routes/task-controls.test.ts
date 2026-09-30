import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("task control routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const jobs: Array<{ taskId: string; jobId?: string }> = [];
  let failPublication = false;
  const app = buildApp({
    repositories,
    queue: {
      publish: async (job, options) => {
        if (failPublication) throw new Error("redis unavailable");
        jobs.push({ taskId: job.taskId, jobId: options?.jobId });
      }
    }
  });

  beforeEach(async () => {
    jobs.length = 0;
    failPublication = false;
    await resetFoundationDatabase(databaseUrl);
  });
  afterAll(async () => {
    await app.close();
    await repositories.close();
  });

  async function createQueuedTask() {
    const created = await app.inject({ method: "POST", url: "/v1/bots", payload: { name: "Control Bot", persona: "safe" } });
    const conversationId = created.json().conversation.id as string;
    const queued = await app.inject({ method: "POST", url: `/v1/conversations/${conversationId}/messages`, payload: { content: "run" } });
    return { conversationId, taskId: queued.json().task.id as string };
  }

  it("pauses queued work and exposes it through active-task", async () => {
    const { conversationId, taskId } = await createQueuedTask();
    const paused = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().task.status).toBe("paused");
    const active = await app.inject({ method: "GET", url: `/v1/conversations/${conversationId}/active-task` });
    expect(active.json().controlState.task.id).toBe(taskId);
  });

  it("resumes a paused task with a stable job id", async () => {
    const { taskId } = await createQueuedTask();
    await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} });
    const resumed = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/resume`, payload: {} });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().task.status).toBe("queued");
    expect(jobs.at(-1)).toEqual({ taskId, jobId: `task:${taskId}:resume` });
  });

  it("returns 404 for another user and 409 for an invalid transition", async () => {
    const { taskId } = await createQueuedTask();
    const other = buildApp({ repositories, queue: { publish: async () => undefined }, userId: "user_other" });
    expect((await other.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} })).statusCode).toBe(404);
    await other.close();
    await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} });
    expect((await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} })).statusCode).toBe(409);
  });

  it("moves a resume publication failure to a stable failure code", async () => {
    const { taskId } = await createQueuedTask();
    await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/pause`, payload: {} });
    failPublication = true;
    const response = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/resume`, payload: {} });
    expect(response.statusCode).toBe(500);
    expect((await repositories.getTask(taskId))?.status).toBe("failed");
    expect((await repositories.listTaskEvents(taskId, 0)).at(-1)?.payload).toMatchObject({ errorCode: "TASK_PUBLICATION_FAILED" });
  });
});
