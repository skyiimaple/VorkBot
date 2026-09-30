import { describe, expect, it } from "vitest";
import {
  AcquireSlotInputSchema,
  FileWriteInputSchema,
  SlotLeaseSchema,
  TerminalReadInputSchema,
  TerminalReadResultSchema,
  TerminalStartInputSchema,
  TerminalStartResultSchema
} from "./computer.js";

describe("computer contracts", () => {
  it("accepts terminal slot acquisition", () => {
    expect(AcquireSlotInputSchema.parse({ taskId: "t1", botId: "b1", kind: "terminal" }).kind).toBe("terminal");
    expect(AcquireSlotInputSchema.parse({ taskId: "t2", botId: "b1", kind: "agent" }).kind).toBe("agent");
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

  it("validates terminal start and incremental read contracts", () => {
    expect(TerminalStartInputSchema.parse({ leaseId: "lease_1", command: "pnpm test" })).toEqual({
      leaseId: "lease_1",
      command: "pnpm test"
    });
    expect(
      TerminalStartResultSchema.parse({ sessionId: "term_1", status: "running", startedAt: "2026-09-28T00:00:00.000Z" })
    ).toMatchObject({ sessionId: "term_1", status: "running" });
    expect(TerminalReadInputSchema.safeParse({ leaseId: "lease_1", sessionId: "term_1", cursor: -1 }).success).toBe(false);
    expect(
      TerminalReadResultSchema.parse({
        sessionId: "term_1",
        output: "ok\n",
        nextCursor: 3,
        truncated: false,
        status: "exited",
        exitCode: 0
      })
    ).toMatchObject({ nextCursor: 3, status: "exited", exitCode: 0 });
  });
});
