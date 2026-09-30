import { describe, expect, it } from "vitest";
import { toRoutineTrigger } from "./RoutinesPage";

describe("routine form schedule conversion", () => {
  it("converts daily and weekly schedules to standard five-field cron", () => {
    expect(toRoutineTrigger("daily", "09:30", "", "1", "")).toEqual({ type: "cron", expression: "30 09 * * *" });
    expect(toRoutineTrigger("weekly", "18:05", "", "5", "")).toEqual({ type: "cron", expression: "05 18 * * 5" });
  });

  it("converts a local one-time value to ISO and preserves advanced cron", () => {
    expect(toRoutineTrigger("once", "", "2026-10-01T09:00", "", "")).toMatchObject({ type: "once" });
    expect(toRoutineTrigger("advanced", "", "", "", "0 9 * * 1-5")).toEqual({ type: "cron", expression: "0 9 * * 1-5" });
  });
});
