import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((path) => !path.startsWith("/"), { message: "Path must be relative" })
  .refine((path) => !path.includes(".."), { message: "Path traversal is not allowed" });

export const SlotKindSchema = z.enum(["file", "browser", "terminal", "agent"]);

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

export const TerminalStatusSchema = z.enum(["running", "exited", "terminated"]);

export const TerminalStartInputSchema = z
  .object({
    leaseId: IdentifierSchema,
    command: z.string().trim().min(1).max(20_000).optional(),
    cols: z.number().int().min(20).max(500).optional(),
    rows: z.number().int().min(5).max(300).optional()
  })
  .strict();

export const TerminalStartResultSchema = z
  .object({
    sessionId: IdentifierSchema,
    status: TerminalStatusSchema,
    startedAt: DateTimeSchema
  })
  .strict();

export const TerminalWriteInputSchema = z
  .object({ leaseId: IdentifierSchema, sessionId: IdentifierSchema, input: z.string().max(100_000) })
  .strict();

export const TerminalReadInputSchema = z
  .object({
    leaseId: IdentifierSchema,
    sessionId: IdentifierSchema,
    cursor: z.number().int().nonnegative().optional(),
    maxBytes: z.number().int().positive().max(65_536).optional()
  })
  .strict();

export const TerminalReadResultSchema = z
  .object({
    sessionId: IdentifierSchema,
    output: z.string(),
    nextCursor: z.number().int().nonnegative(),
    truncated: z.boolean(),
    status: TerminalStatusSchema,
    exitCode: z.number().int().nullable().optional()
  })
  .strict();

export const TerminalTerminateInputSchema = z
  .object({ leaseId: IdentifierSchema, sessionId: IdentifierSchema })
  .strict();

export type SlotKind = z.infer<typeof SlotKindSchema>;
export type AcquireSlotInput = z.infer<typeof AcquireSlotInputSchema>;
export type SlotLease = z.infer<typeof SlotLeaseSchema>;
export type ComputerError = z.infer<typeof ComputerErrorSchema>;
export type FileWriteInput = z.infer<typeof FileWriteInputSchema>;
export type FileReadResult = z.infer<typeof FileReadResultSchema>;
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export type TerminalStartInput = z.infer<typeof TerminalStartInputSchema>;
export type TerminalStartResult = z.infer<typeof TerminalStartResultSchema>;
export type TerminalWriteInput = z.infer<typeof TerminalWriteInputSchema>;
export type TerminalReadInput = z.infer<typeof TerminalReadInputSchema>;
export type TerminalReadResult = z.infer<typeof TerminalReadResultSchema>;
export type TerminalTerminateInput = z.infer<typeof TerminalTerminateInputSchema>;
