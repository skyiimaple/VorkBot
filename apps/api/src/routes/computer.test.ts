import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import { buildApp } from "../app.js";

describe("computer frame proxy", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });

  beforeEach(async () => {
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await repos.close();
  });

  it("forwards JPEG frames from the computer service", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "Frame Bot", persona: "画面" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repos.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content: "[browser-demo]"
    });
    await repos.appendTaskEvent({
      taskId: queued.task.id,
      type: "slot.acquired",
      payload: { slotId: "slot_1", leaseId: "lease_1" }
    });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(jpeg, {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      })
    );

    const app = buildApp({
      repositories: repos,
      queue: { publish: async () => undefined },
      computer: {
        baseUrl: "http://computer:8080",
        token: "secret",
        fetch: fetchMock
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/computer/slots/slot_1/frame?taskId=${encodeURIComponent(queued.task.id)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(response.rawPayload)).toEqual(jpeg);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/slots/slot_1/frame?leaseId=lease_1");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: "Bearer secret"
      }
    });
  });
});
