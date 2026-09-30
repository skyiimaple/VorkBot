import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

export const RoutineTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), runAt: DateTimeSchema }).strict(),
  z.object({ type: z.literal("cron"), expression: z.string().trim().min(1).max(255) }).strict()
]);

export const RoutineStatusSchema = z.enum(["active", "paused", "completed", "error", "deleted"]);
export const RoutineRunStatusSchema = z.enum([
  "claimed",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting_approval",
  "paused",
  "uncertain",
  "skipped_overlap",
  "publication_failed"
]);

export const RoutineSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  botId: IdentifierSchema,
  conversationId: IdentifierSchema,
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(20_000),
  trigger: RoutineTriggerSchema,
  timezone: z.string().trim().min(1).max(100),
  status: RoutineStatusSchema,
  nextRunAt: DateTimeSchema.nullable(),
  lastRunAt: DateTimeSchema.nullable(),
  lastRunStatus: RoutineRunStatusSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
}).strict();

export const RoutineRunSchema = z.object({
  id: IdentifierSchema,
  routineId: IdentifierSchema,
  userId: IdentifierSchema,
  scheduledFor: DateTimeSchema,
  claimedAt: DateTimeSchema,
  taskId: IdentifierSchema.nullable(),
  status: RoutineRunStatusSchema,
  missedCount: z.number().int().nonnegative(),
  errorCode: z.string().trim().min(1).max(100).nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
}).strict();

const RoutineWriteFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  botId: IdentifierSchema,
  prompt: z.string().trim().min(1).max(20_000),
  trigger: RoutineTriggerSchema,
  timezone: z.string().trim().min(1).max(100)
}).strict();

export const CreateRoutineInputSchema = RoutineWriteFieldsSchema;
export const UpdateRoutineInputSchema = RoutineWriteFieldsSchema.extend({
  version: z.number().int().positive()
}).strict();
export const ListRoutineRunsInputSchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20)
}).strict();
export const ListRoutinesResponseSchema = z.object({ routines: z.array(RoutineSchema) }).strict();
export const RoutineResponseSchema = z.object({ routine: RoutineSchema }).strict();
export const CreateRoutineResponseSchema = z.object({ routine: RoutineSchema, conversationId: IdentifierSchema }).strict();
export const ListRoutineRunsResponseSchema = z.object({
  runs: z.array(RoutineRunSchema),
  nextCursor: z.string().nullable()
}).strict();
export const RunRoutineNowResponseSchema = z.object({ run: RoutineRunSchema, taskId: IdentifierSchema.nullable() }).strict();

export type RoutineTrigger = z.infer<typeof RoutineTriggerSchema>;
export type RoutineStatus = z.infer<typeof RoutineStatusSchema>;
export type RoutineRunStatus = z.infer<typeof RoutineRunStatusSchema>;
export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineRun = z.infer<typeof RoutineRunSchema>;
export type CreateRoutineInput = z.infer<typeof CreateRoutineInputSchema>;
export type UpdateRoutineInput = z.infer<typeof UpdateRoutineInputSchema>;
