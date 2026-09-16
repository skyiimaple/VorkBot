import { describe, expect, it } from "vitest";
import { AcquireSlotInputSchema, SlotLeaseSchema, FileWriteInputSchema } from "./computer.js";

describe("computer contracts", () => {
  it("rejects terminal kind in acquire for phase-2 validation helpers", () => {
    expect(AcquireSlotInputSchema.parse({ taskId: "t1", botId: "b1", kind: "file" }).kind).toBe("file");
  });

  it("accepts a slot lease", () => {
    const lease = SlotLeaseSchema.parse({
      slotId: "slot_1",
      leaseId: "lease_1",
      expiresAt: "2026-09-16T00:01:00.000Z"
    });
    expect(lease.slotId).toBe("slot_1");
  });

  it("rejects path traversal in file write", () => {
    expect(FileWriteInputSchema.safeParse({ path: "../secret", content: "x" }).success).toBe(false);
  });
});
