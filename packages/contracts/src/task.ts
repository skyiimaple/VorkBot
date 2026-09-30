import { z } from "zod";
import { MessageSchema } from "./conversation.js";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

export const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "paused",
  "uncertain",
  "completed",
  "failed",
  "cancelled"
]);

export const TaskSchema = z
  .object({
    id: IdentifierSchema,
    userId: IdentifierSchema,
    botId: IdentifierSchema,
    conversationId: IdentifierSchema,
    messageId: IdentifierSchema,
    status: TaskStatusSchema,
    pauseRequestedAt: DateTimeSchema.nullable(),
    retryCount: z.number().int().nonnegative(),
    nextRetryAt: DateTimeSchema.nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema
  })
  .strict();

export const CheckpointStateSchema = z
  .object({
    nextTurn: z.number().int().nonnegative(),
    lastObservation: z.string().max(4000),
    reply: z.string(),
    modelTurns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    lastCompletedToolCallId: IdentifierSchema.nullable()
  })
  .strict();

export const TaskControlSummarySchema = z
  .object({
    id: IdentifierSchema,
    actionType: z.string().trim().min(1).max(64),
    riskReason: z.string().trim().min(1).max(500),
    target: z.string().trim().min(1).max(512)
  })
  .strict();

export const TaskControlStateSchema = z
  .object({
    task: TaskSchema,
    pendingApproval: TaskControlSummarySchema.optional(),
    uncertainToolCall: TaskControlSummarySchema.optional()
  })
  .strict();

export const ActiveTaskResponseSchema = z.object({ controlState: TaskControlStateSchema.nullable() }).strict();
export const PauseTaskInputSchema = z.object({}).strict();
export const ResumeTaskInputSchema = z.object({}).strict();
export const UncertainResolutionInputSchema = z
  .object({ resolution: z.enum(["confirmed_success", "retry", "cancel"]) })
  .strict();

export const TaskEventSchema = z.object({
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  userId: IdentifierSchema,
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  payload: z.unknown(),
  createdAt: DateTimeSchema
});

export const TaskJobSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  botId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1)
});

export const CreateQueuedMessageTaskInputSchema = z.object({
  userId: IdentifierSchema,
  botId: IdentifierSchema,
  conversationId: IdentifierSchema,
  content: z.string().trim().min(1)
});

export const QueuedMessageTaskResultSchema = z.object({
  message: MessageSchema,
  task: TaskSchema,
  event: TaskEventSchema
});

export const TaskPublicationFailureResponseSchema = z.object({
  error: z.object({ code: z.literal("TASK_PUBLICATION_FAILED") }),
  task: TaskSchema
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type CheckpointState = z.infer<typeof CheckpointStateSchema>;
export type TaskControlSummary = z.infer<typeof TaskControlSummarySchema>;
export type TaskControlState = z.infer<typeof TaskControlStateSchema>;
export type ActiveTaskResponse = z.infer<typeof ActiveTaskResponseSchema>;
export type UncertainResolutionInput = z.infer<typeof UncertainResolutionInputSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskJob = z.infer<typeof TaskJobSchema>;
export type CreateQueuedMessageTaskInput = z.infer<typeof CreateQueuedMessageTaskInputSchema>;
export type QueuedMessageTaskResult = z.infer<typeof QueuedMessageTaskResultSchema>;
export type TaskPublicationFailureResponse = z.infer<typeof TaskPublicationFailureResponseSchema>;
