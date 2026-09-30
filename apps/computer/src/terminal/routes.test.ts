import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildComputerApp } from "../server.js";

describe("terminal routes", () => {
  let app: FastifyInstance;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "vork-terminal-routes-"));
    app = buildComputerApp({ token: "test-token", maxSlots: 1, workspaceRoot });
  });

  afterEach(async () => {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("starts, reads, and terminates a leased terminal", async () => {
    const acquire = await app.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: "Bearer test-token" },
      payload: { taskId: "task_1", botId: "bot_1", kind: "terminal" }
    });
    expect(acquire.statusCode).toBe(200);
    const leaseId = acquire.json().leaseId as string;

    const start = await app.inject({
      method: "POST",
      url: "/v1/terminal/start",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId, command: "printf route-ok" }
    });
    expect(start.statusCode).toBe(200);
    const sessionId = start.json().sessionId as string;

    let output = "";
    const deadline = Date.now() + 3000;
    while (!output.includes("route-ok") && Date.now() < deadline) {
      const read = await app.inject({
        method: "POST",
        url: "/v1/terminal/read",
        headers: { authorization: "Bearer test-token" },
        payload: { leaseId, sessionId, cursor: 0 }
      });
      expect(read.statusCode).toBe(200);
      output = read.json().output;
      if (!output.includes("route-ok")) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(output).toContain("route-ok");

    const terminate = await app.inject({
      method: "POST",
      url: "/v1/terminal/terminate",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId, sessionId }
    });
    expect(terminate.statusCode).toBe(200);
  });

  it("rejects terminal operations through a file lease", async () => {
    const acquire = await app.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: "Bearer test-token" },
      payload: { taskId: "task_2", botId: "bot_2", kind: "file" }
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/terminal/start",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId: acquire.json().leaseId, command: "whoami" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("terminal_lease_required");
  });

  it("rejects reads after the terminal lease expires", async () => {
    await app.close();
    app = buildComputerApp({ token: "test-token", maxSlots: 1, workspaceRoot, leaseTtlMs: 10 });
    const acquire = await app.inject({
      method: "POST",
      url: "/v1/slots/acquire",
      headers: { authorization: "Bearer test-token" },
      payload: { taskId: "task_3", botId: "bot_3", kind: "terminal" }
    });
    const leaseId = acquire.json().leaseId as string;
    const start = await app.inject({
      method: "POST",
      url: "/v1/terminal/start",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId, command: "sleep 30" }
    });
    await new Promise((resolve) => setTimeout(resolve, 15));

    const read = await app.inject({
      method: "POST",
      url: "/v1/terminal/read",
      headers: { authorization: "Bearer test-token" },
      payload: { leaseId, sessionId: start.json().sessionId, cursor: 0 }
    });
    expect(read.statusCode).toBe(409);
    expect(read.json().code).toBe("lease_expired");
  });
});
