import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("routine routes", () => {
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

  async function createBot() {
    return repositories.createBot({ userId: "user_local", name: "Routine Bot", persona: "scheduled" });
  }

  async function createRoutine() {
    const bot = await createBot();
    const response = await app.inject({
      method: "POST",
      url: "/v1/routines",
      payload: {
        name: "晨报",
        botId: bot.id,
        prompt: "生成晨报",
        trigger: { type: "cron", expression: "0 9 * * *" },
        timezone: "Asia/Shanghai"
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { routine: { id: string; version: number; conversationId: string }; conversationId: string };
  }

  it("supports create, list, get, update, pause, enable, and soft delete", async () => {
    const created = await createRoutine();
    expect(created.conversationId).toBe(created.routine.conversationId);
    expect((await app.inject({ method: "GET", url: "/v1/routines" })).json().routines).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/v1/routines/${created.routine.id}` })).statusCode).toBe(200);

    const bot = (await repositories.listBots("user_local"))[0]!;
    const updated = await app.inject({
      method: "PUT",
      url: `/v1/routines/${created.routine.id}`,
      payload: {
        name: "晚报",
        botId: bot.id,
        prompt: "生成晚报",
        trigger: { type: "cron", expression: "0 18 * * *" },
        timezone: "Asia/Shanghai",
        version: created.routine.version
      }
    });
    expect(updated.json().routine).toMatchObject({ name: "晚报", conversationId: created.conversationId });
    expect((await app.inject({ method: "POST", url: `/v1/routines/${created.routine.id}/pause`, payload: {} })).json().routine.status).toBe("paused");
    expect((await app.inject({ method: "POST", url: `/v1/routines/${created.routine.id}/enable`, payload: {} })).json().routine.status).toBe("active");
    expect((await app.inject({ method: "DELETE", url: `/v1/routines/${created.routine.id}` })).json().routine.status).toBe("deleted");
    expect(await repositories.getConversation({ userId: "user_local", conversationId: created.conversationId })).not.toBeNull();
  });

  it("runs now with a stable job id, reports overlap, and lists history", async () => {
    const created = await createRoutine();
    const first = await app.inject({ method: "POST", url: `/v1/routines/${created.routine.id}/run-now`, payload: {} });
    expect(first.statusCode).toBe(200);
    expect(jobs[0]?.jobId).toMatch(/^routine-run-/);
    expect((await app.inject({ method: "POST", url: `/v1/routines/${created.routine.id}/run-now`, payload: {} })).statusCode).toBe(409);
    const history = await app.inject({ method: "GET", url: `/v1/routines/${created.routine.id}/runs?limit=1` });
    expect(history.json()).toMatchObject({ runs: [{ status: "skipped_overlap" }] });
    expect(history.json().nextCursor).toEqual(expect.any(String));
    const next = await app.inject({
      method: "GET",
      url: `/v1/routines/${created.routine.id}/runs?limit=1&cursor=${history.json().nextCursor}`
    });
    expect(next.json()).toMatchObject({ runs: [{ status: "queued" }], nextCursor: null });
  });

  it("maps invalid schedules, version conflicts, cross-user access, and publication failures", async () => {
    const bot = await createBot();
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/routines",
      payload: { name: "坏任务", botId: bot.id, prompt: "run", trigger: { type: "cron", expression: "0 0 9 * * *" }, timezone: "Asia/Shanghai" }
    });
    expect(invalid.statusCode).toBe(400);

    const created = await createRoutine();
    const conflict = await app.inject({
      method: "PUT",
      url: `/v1/routines/${created.routine.id}`,
      payload: { name: "冲突", botId: bot.id, prompt: "run", trigger: { type: "cron", expression: "0 9 * * *" }, timezone: "Asia/Shanghai", version: 999 }
    });
    expect(conflict.statusCode).toBe(409);

    const other = buildApp({ repositories, queue: { publish: async () => undefined }, userId: "user_other" });
    expect((await other.inject({ method: "GET", url: `/v1/routines/${created.routine.id}` })).statusCode).toBe(404);
    await other.close();

    failPublication = true;
    const failed = await app.inject({ method: "POST", url: `/v1/routines/${created.routine.id}/run-now`, payload: {} });
    expect(failed.statusCode).toBe(500);
    const runs = await repositories.listRoutineRuns(created.routine.id, "user_local", 20);
    expect(runs[0]).toMatchObject({ status: "publication_failed", errorCode: "ROUTINE_PUBLICATION_FAILED" });
  });
});
