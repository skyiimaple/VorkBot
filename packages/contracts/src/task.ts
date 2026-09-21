import { z } from "zod";
import { MessageSchema } from "./conversation.js";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

export const TaskSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  botId: IdentifierSchema,
  conversationId: IdentifierSchema,
  messageId: IdentifierSchema,
  status: z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
});

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
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskJob = z.infer<typeof TaskJobSchema>;
export type CreateQueuedMessageTaskInput = z.infer<typeof CreateQueuedMessageTaskInputSchema>;
export type QueuedMessageTaskResult = z.infer<typeof QueuedMessageTaskResultSchema>;
export type TaskPublicationFailureResponse = z.infer<typeof TaskPublicationFailureResponseSchema>;
