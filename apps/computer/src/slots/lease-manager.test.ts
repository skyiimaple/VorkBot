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

  it("allows three file slots and rejects the fourth", () => {
    const mgr = new LeaseManager({ maxSlots: 3, maxBrowserSlots: 2 });
    for (let index = 1; index <= 3; index += 1) {
      expect(mgr.acquire({ taskId: `t${index}`, botId: "b1", kind: "file" })).toMatchObject({
        slotId: `slot_${index}`
      });
    }
    expect(mgr.acquire({ taskId: "t4", botId: "b1", kind: "file" })).toEqual({ code: "no_slot" });
  });

  it("limits browser concurrency to two even when slots remain", () => {
    const mgr = new LeaseManager({ maxSlots: 3, maxBrowserSlots: 2 });
    expect(mgr.acquire({ taskId: "b1", botId: "bot", kind: "browser" })).toMatchObject({ slotId: "slot_1" });
    expect(mgr.acquire({ taskId: "b2", botId: "bot", kind: "browser" })).toMatchObject({ slotId: "slot_2" });
    expect(mgr.acquire({ taskId: "f1", botId: "bot", kind: "file" })).toMatchObject({ slotId: "slot_3" });
    expect(mgr.acquire({ taskId: "b3", botId: "bot", kind: "browser" })).toEqual({
      code: "browser_concurrency_limit"
    });
  });

  it("rejects browser acquires under memory pressure", () => {
    const mgr = new LeaseManager({
      maxSlots: 3,
      maxBrowserSlots: 2,
      isMemoryPressure: () => true
    });
    expect(mgr.acquire({ taskId: "b1", botId: "bot", kind: "browser" })).toEqual({
      code: "memory_pressure"
    });
    expect(mgr.acquire({ taskId: "f1", botId: "bot", kind: "file" })).toMatchObject({ slotId: "slot_1" });
  });
});
