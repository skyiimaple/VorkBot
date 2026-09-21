import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildComputerApp } from "../server.js";

describe("file routes", () => {
  let app: FastifyInstance;
  let workspaceRoot: string;
  let activeLeaseId: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "vork-workspace-"));
    app = buildComputerApp({ token: "test-token", maxSlots: 1, workspaceRoot });

    const acquire = await app.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: "Bearer test-token" },
      payload: { taskId: "task_1", botId: "bot_1", kind: "file" }
    });
    activeLeaseId = acquire.json().leaseId;
  });

  afterEach(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("rejects shared write", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/files/write",
      headers: { authorization: "Bearer test-token" },
      payload: {
        leaseId: activeLeaseId,
        path: "shared/x.txt",
        content: "nope",
        root: "shared"
      }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("read_only_root");
  });

  it("writes and reads bot files", async () => {
    const write = await app.inject({
      method: "POST",
      url: "/v1/files/write",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: activeLeaseId, path: "hello.txt", content: "hello world" }
    });
    expect(write.statusCode).toBe(200);
    expect(write.json()).toMatchObject({ path: "hello.txt", bytes: 11 });

    const read = await app.inject({
      method: "POST",
      url: "/v1/files/read",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: activeLeaseId, path: "hello.txt" }
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      path: "hello.txt",
      content: "hello world",
      bytes: 11
    });
  });

  it("rejects mkdir on shared root", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/files/mkdir",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: activeLeaseId, path: "nested", root: "shared" }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("read_only_root");
  });

  it("rejects expired lease", async () => {
    await app.close();

    const shortTtlApp = buildComputerApp({
      token: "test-token",
      maxSlots: 1,
      workspaceRoot,
      leaseTtlMs: 10
    });

    const acquire = await shortTtlApp.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: "Bearer test-token" },
      payload: { taskId: "task_2", botId: "bot_1", kind: "file" }
    });
    const leaseId = acquire.json().leaseId;

    await new Promise((resolve) => setTimeout(resolve, 15));

    const res = await shortTtlApp.inject({
      method: "POST",
      url: "/v1/files/read",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId, path: "missing.txt" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("lease_expired");

    await shortTtlApp.close();
  });

  it("returns empty entries for a new bot workspace", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/files/list",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: activeLeaseId }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entries: [] });
  });

  it("returns not_found for missing files", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/files/read",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: activeLeaseId, path: "missing.txt" }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("not_found");
  });
});
