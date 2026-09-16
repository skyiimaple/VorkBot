import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((path) => !path.startsWith("/"), { message: "Path must be relative" })
  .refine((path) => !path.includes(".."), { message: "Path traversal is not allowed" });

export const SlotKindSchema = z.enum(["file", "browser", "terminal"]);

export const AcquireSlotInputSchema = z.object({
  taskId: IdentifierSchema,
  botId: IdentifierSchema,
  kind: SlotKindSchema
});

export const SlotLeaseSchema = z.object({
  slotId: IdentifierSchema,
  leaseId: IdentifierSchema,
  expiresAt: DateTimeSchema
});

export const ComputerErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
});

export const FileWriteInputSchema = z.object({
  path: RelativePathSchema,
  content: z.string()
});

export const FileReadResultSchema = z.object({
  path: RelativePathSchema,
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean().optional()
});

export type SlotKind = z.infer<typeof SlotKindSchema>;
export type AcquireSlotInput = z.infer<typeof AcquireSlotInputSchema>;
export type SlotLease = z.infer<typeof SlotLeaseSchema>;
export type ComputerError = z.infer<typeof ComputerErrorSchema>;
export type FileWriteInput = z.infer<typeof FileWriteInputSchema>;
export type FileReadResult = z.infer<typeof FileReadResultSchema>;
