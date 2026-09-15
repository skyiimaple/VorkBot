import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("Bot routes", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repositories = createRepositories({ databaseUrl });
  const publishedJobs: unknown[] = [];
  const app = buildApp({
    repositories,
    queue: { publish: async (job) => void publishedJobs.push(job) }
  });

  beforeEach(async () => {
    publishedJobs.length = 0;
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await app.close();
    await repositories.close();
  });

  it("creates a temporary Bot and conversation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "新建 Bot", persona: "待通过对话设置" }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ bot: { name: "新建 Bot" }, conversation: {} });
  });

  it("lists Bots for the temporary user", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/bots",
      payload: { name: "第一个 Bot", persona: "测试" }
    });

    const response = await app.inject({ method: "GET", url: "/v1/bots" });

    expect(response.statusCode).toBe(200);
    expect(response.json().bots).toContainEqual(expect.objectContaining({ name: "第一个 Bot", userId: "user_local" }));
  });
});
