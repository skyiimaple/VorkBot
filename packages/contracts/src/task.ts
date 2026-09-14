import { z } from "zod";

const IdentifierSchema = z.string().min(1);
const DateTimeSchema = z.string().datetime();

export const TaskSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  botId: IdentifierSchema,
  conversationId: IdentifierSchema,
  messageId: IdentifierSchema,
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
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

export type Task = z.infer<typeof TaskSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskJob = z.infer<typeof TaskJobSchema>;
