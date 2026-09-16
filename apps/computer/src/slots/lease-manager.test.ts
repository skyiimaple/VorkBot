import { describe, expect, it } from "vitest";
import { LeaseManager } from "./lease-manager.js";

describe("LeaseManager", () => {
  it("acquires and releases the only slot", () => {
    const mgr = new LeaseManager({ maxSlots: 1, ttlMs: 60_000 });
    const lease = mgr.acquire({ taskId: "t1", botId: "b1", kind: "file" });
    expect(lease).toMatchObject({ slotId: "slot_1" });
    if ("code" in lease) {
      throw new Error("expected slot lease");
    }
    expect(mgr.acquire({ taskId: "t2", botId: "b2", kind: "file" })).toEqual({
      code: "no_slot"
    });
    mgr.release(lease.leaseId);
    expect(mgr.acquire({ taskId: "t3", botId: "b3", kind: "file" })).toMatchObject({
      slotId: "slot_1"
    });
  });

  it("expires lease after ttl", async () => {
    const mgr = new LeaseManager({ maxSlots: 1, ttlMs: 10 });
    const lease = mgr.acquire({ taskId: "t1", botId: "b1", kind: "file" });
    expect(lease).toMatchObject({ slotId: "slot_1" });
    if ("code" in lease) {
      throw new Error("expected slot lease");
    }
    await new Promise((r) => setTimeout(r, 15));
    expect(() => mgr.assertActive(lease.leaseId)).toThrow(/lease_expired/);
  });
});
