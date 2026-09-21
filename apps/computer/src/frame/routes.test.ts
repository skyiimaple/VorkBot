import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { LeaseManager } from "../slots/lease-manager.js";
import { registerFrameRoutes } from "./routes.js";

describe("frame routes", () => {
  it("rejects frame requests for file leases", async () => {
    const app = Fastify();
    const leaseManager = new LeaseManager({ maxSlots: 1, ttlMs: 60_000 });
    const lease = leaseManager.acquire({ taskId: "t1", botId: "b1", kind: "file" });
    if ("code" in lease) {
      throw new Error("expected lease");
    }

    registerFrameRoutes(app, {
      leaseManager,
      sessions: {
        getOrCreate: vi.fn(),
        get: vi.fn(),
        stop: vi.fn()
      } as never
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/slots/${lease.slotId}/frame?leaseId=${encodeURIComponent(lease.leaseId)}`
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("browser_unavailable");
    await app.close();
  });

  it("returns frame_unavailable when capture yields an empty buffer", async () => {
    const app = Fastify();
    const leaseManager = new LeaseManager({ maxSlots: 1, ttlMs: 60_000 });
    const lease = leaseManager.acquire({ taskId: "t1", botId: "b1", kind: "browser" });
    if ("code" in lease) {
      throw new Error("expected lease");
    }

    registerFrameRoutes(app, {
      leaseManager,
      sessions: {
        getOrCreate: () => ({
          start: async () => undefined,
          captureFrame: async () => Buffer.alloc(0)
        }),
        get: vi.fn(),
        stop: vi.fn()
      } as never
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/slots/${lease.slotId}/frame?leaseId=${encodeURIComponent(lease.leaseId)}`
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("frame_unavailable");
    await app.close();
  });

  it("returns jpeg when a browser session can capture a frame", async () => {
    const app = Fastify();
    const leaseManager = new LeaseManager({ maxSlots: 1, ttlMs: 60_000 });
    const lease = leaseManager.acquire({ taskId: "t1", botId: "b1", kind: "browser" });
    if ("code" in lease) {
      throw new Error("expected lease");
    }

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    registerFrameRoutes(app, {
      leaseManager,
      sessions: {
        getOrCreate: () => ({
          start: async () => undefined,
          captureFrame: async () => jpeg
        }),
        get: vi.fn(),
        stop: vi.fn()
      } as never
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/slots/${lease.slotId}/frame?leaseId=${encodeURIComponent(lease.leaseId)}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(res.rawPayload)).toEqual(jpeg);
    await app.close();
  });
});
