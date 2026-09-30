import { describe, expect, it } from "vitest";
import { advanceDueSchedule, calculateNextRun } from "./routine-schedule.js";

describe("routine schedule", () => {
  it("calculates a five-field cron in its IANA timezone", () => {
    expect(calculateNextRun(
      { type: "cron", expression: "0 9 * * *" },
      "Asia/Shanghai",
      new Date("2026-09-30T00:30:00.000Z")
    )).toBe("2026-09-30T01:00:00.000Z");
  });

  it("counts missed occurrences while advancing strictly into the future", () => {
    expect(advanceDueSchedule(
      { type: "cron", expression: "0 * * * *" },
      "Asia/Shanghai",
      new Date("2026-09-30T01:00:00.000Z"),
      new Date("2026-09-30T04:30:00.000Z")
    )).toEqual({ nextRunAt: "2026-09-30T05:00:00.000Z", missedCount: 3 });
  });

  it("returns no next run for a claimed one-time trigger", () => {
    expect(advanceDueSchedule(
      { type: "once", runAt: "2026-09-30T01:00:00.000Z" },
      "Asia/Shanghai",
      new Date("2026-09-30T01:00:00.000Z"),
      new Date("2026-09-30T02:00:00.000Z")
    )).toEqual({ nextRunAt: null, missedCount: 0 });
  });

  it.each([
    [{ type: "cron", expression: "0 0 9 * * *" }, "Asia/Shanghai", "ROUTINE_INVALID_CRON"],
    [{ type: "cron", expression: "H 9 * * *" }, "Asia/Shanghai", "ROUTINE_INVALID_CRON"],
    [{ type: "cron", expression: "0 9 * * *" }, "Mars/Olympus", "ROUTINE_INVALID_TIMEZONE"],
    [{ type: "once", runAt: "2026-09-29T01:00:00.000Z" }, "Asia/Shanghai", "ROUTINE_ONCE_IN_PAST"]
  ] as const)("rejects invalid schedule %#", (trigger, timezone, code) => {
    expect(() => calculateNextRun(trigger, timezone, new Date("2026-09-30T00:00:00.000Z"))).toThrowError(code);
  });

  it("handles a daylight-saving transition in the selected timezone", () => {
    expect(calculateNextRun(
      { type: "cron", expression: "30 2 * * *" },
      "Europe/London",
      new Date("2026-03-28T03:00:00.000Z")
    )).toBe("2026-03-29T01:30:00.000Z");
  });
});
