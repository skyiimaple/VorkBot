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
});
