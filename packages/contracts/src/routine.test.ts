import { describe, expect, it } from "vitest";
import {
  CreateRoutineInputSchema,
  ListRoutineRunsInputSchema,
  RoutineRunSchema,
  RoutineSchema,
  RoutineTriggerSchema,
  UpdateRoutineInputSchema
} from "./routine.js";

const once = { type: "once", runAt: "2026-10-01T01:00:00.000Z" } as const;
const cron = { type: "cron", expression: "0 9 * * 1-5" } as const;

describe("routine contracts", () => {
  it("accepts strict once and cron triggers", () => {
    expect(RoutineTriggerSchema.parse(once)).toEqual(once);
    expect(RoutineTriggerSchema.parse(cron)).toEqual(cron);
    expect(RoutineTriggerSchema.safeParse({ ...cron, extra: true }).success).toBe(false);
    expect(RoutineTriggerSchema.safeParse({ type: "interval", seconds: 10 }).success).toBe(false);
  });

  it("validates create and versioned update inputs", () => {
    const create = {
      name: "晨报",
      botId: "bot_1",
      prompt: "生成今天的晨报",
      trigger: cron,
      timezone: "Asia/Shanghai"
    };
    expect(CreateRoutineInputSchema.parse(create)).toEqual(create);
    expect(CreateRoutineInputSchema.safeParse({ ...create, name: " " }).success).toBe(false);
    expect(CreateRoutineInputSchema.safeParse({ ...create, userId: "user_1" }).success).toBe(false);
    expect(UpdateRoutineInputSchema.safeParse({ ...create, version: 0 }).success).toBe(false);
    expect(UpdateRoutineInputSchema.safeParse({ ...create, version: 1 }).success).toBe(true);
  });

  it("parses routine and run records without accepting unknown fields", () => {
    const routine = {
      id: "routine_1",
      userId: "user_1",
      botId: "bot_1",
      conversationId: "conversation_1",
      name: "晨报",
      prompt: "生成晨报",
      trigger: cron,
      timezone: "Asia/Shanghai",
      status: "active",
      nextRunAt: "2026-10-01T01:00:00.000Z",
      lastRunAt: null,
      lastRunStatus: null,
      version: 1,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z"
    };
    expect(RoutineSchema.parse(routine)).toEqual(routine);
    expect(RoutineSchema.safeParse({ ...routine, hidden: true }).success).toBe(false);

    const run = {
      id: "routine_run_1",
      routineId: routine.id,
      userId: routine.userId,
      scheduledFor: routine.nextRunAt,
      claimedAt: routine.nextRunAt,
      taskId: null,
      status: "skipped_overlap",
      missedCount: 3,
      errorCode: null,
      createdAt: routine.createdAt,
      updatedAt: routine.updatedAt
    };
    expect(RoutineRunSchema.parse(run)).toEqual(run);
    expect(RoutineRunSchema.safeParse({ ...run, missedCount: -1 }).success).toBe(false);
  });

  it("bounds routine run pagination", () => {
    expect(ListRoutineRunsInputSchema.parse({ limit: 20 })).toEqual({ limit: 20 });
    expect(ListRoutineRunsInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(ListRoutineRunsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
