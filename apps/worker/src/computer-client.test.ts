import { describe, expect, it, vi } from "vitest";
import { ComputerClient, ComputerClientError } from "./computer-client.js";

describe("ComputerClient", () => {
  it("acquires a slot lease", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        slotId: "slot_1",
        leaseId: "lease_1",
        expiresAt: "2026-09-16T00:01:00.000Z"
      })
    );
    const client = new ComputerClient({ baseUrl: "http://computer:8080", token: "secret", fetch: fetchMock });

    const lease = await client.acquire({ taskId: "task_1", botId: "bot_1", kind: "file" });

    expect(lease.slotId).toBe("slot_1");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/v1/slots/acquire", "http://computer:8080"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" })
      })
    );
  });

  it("throws on no_slot", async () => {
    const client = new ComputerClient({
      baseUrl: "http://computer:8080",
      token: "secret",
      fetch: vi.fn(async () => Response.json({ code: "no_slot" }, { status: 503 }))
    });

    await expect(client.acquire({ taskId: "task_1", botId: "bot_1", kind: "file" })).rejects.toMatchObject({
      code: "no_slot",
      status: 503
    } satisfies Partial<ComputerClientError>);
  });

  it("starts and incrementally reads a terminal session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ sessionId: "terminal_1", status: "running", startedAt: "2026-09-28T00:00:00.000Z" })
      )
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "terminal_1",
          output: "ok\n",
          nextCursor: 3,
          truncated: false,
          status: "exited",
          exitCode: 0
        })
      );
    const client = new ComputerClient({ baseUrl: "http://computer:8080", token: "secret", fetch: fetchMock });

    await expect(client.startTerminal("lease_1", "pnpm test")).resolves.toMatchObject({ sessionId: "terminal_1" });
    await expect(client.readTerminal("lease_1", "terminal_1", 0)).resolves.toMatchObject({
      output: "ok\n",
      nextCursor: 3
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://computer:8080/v1/terminal/start",
      "http://computer:8080/v1/terminal/read"
    ]);
  });
});
