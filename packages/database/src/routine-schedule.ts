import { CronExpressionParser } from "cron-parser";
import type { RoutineTrigger } from "@vork/contracts";

export type RoutineScheduleErrorCode =
  | "ROUTINE_INVALID_CRON"
  | "ROUTINE_INVALID_TIMEZONE"
  | "ROUTINE_ONCE_IN_PAST"
  | "ROUTINE_SCHEDULE_OVERFLOW";

export class RoutineScheduleError extends Error {
  constructor(readonly code: RoutineScheduleErrorCode) {
    super(code);
    this.name = "RoutineScheduleError";
  }
}

const MAX_MISSED_OCCURRENCES = 10_000;
const NON_STANDARD_CRON = /[@HL#?]/i;

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new RoutineScheduleError("ROUTINE_INVALID_TIMEZONE");
  }
}

function parseCron(expression: string, timezone: string, currentDate: Date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || NON_STANDARD_CRON.test(expression)) {
    throw new RoutineScheduleError("ROUTINE_INVALID_CRON");
  }
  try {
    return CronExpressionParser.parse(expression, { currentDate, tz: timezone });
  } catch {
    throw new RoutineScheduleError("ROUTINE_INVALID_CRON");
  }
}

export function calculateNextRun(trigger: RoutineTrigger, timezone: string, now: Date): string {
  validateTimezone(timezone);
  if (trigger.type === "once") {
    const runAt = new Date(trigger.runAt);
    if (runAt.getTime() <= now.getTime()) throw new RoutineScheduleError("ROUTINE_ONCE_IN_PAST");
    return runAt.toISOString();
  }
  return parseCron(trigger.expression, timezone, now).next().toDate().toISOString();
}

export function advanceDueSchedule(
  trigger: RoutineTrigger,
  timezone: string,
  scheduledFor: Date,
  now: Date
): { nextRunAt: string | null; missedCount: number } {
  validateTimezone(timezone);
  if (trigger.type === "once") return { nextRunAt: null, missedCount: 0 };

  let cursor = scheduledFor;
  let missedCount = 0;
  while (missedCount <= MAX_MISSED_OCCURRENCES) {
    const next = parseCron(trigger.expression, timezone, cursor).next().toDate();
    if (next.getTime() > now.getTime()) {
      return { nextRunAt: next.toISOString(), missedCount };
    }
    missedCount += 1;
    cursor = next;
  }
  throw new RoutineScheduleError("ROUTINE_SCHEDULE_OVERFLOW");
}
