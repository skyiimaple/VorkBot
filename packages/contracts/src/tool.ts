import { z } from "zod";

export const SLOT_EVENT_TYPES = {
  ACQUIRED: "slot.acquired",
  RELEASED: "slot.released",
  WAITING: "slot.waiting",
  WAIT_EXHAUSTED: "slot.wait_exhausted"
} as const;

export const TOOL_EVENT_TYPES = {
  STARTED: "tool.started",
  FINISHED: "tool.finished",
  FAILED: "tool.failed"
} as const;

export const LEASE_EVENT_TYPES = {
  LOST: "lease.lost"
} as const;

export const ToolEventPayloadSchema = z.object({
  toolName: z.string().min(1),
  path: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  reason: z.string().optional()
});

export type SlotEventType = (typeof SLOT_EVENT_TYPES)[keyof typeof SLOT_EVENT_TYPES];
export type ToolEventType = (typeof TOOL_EVENT_TYPES)[keyof typeof TOOL_EVENT_TYPES];
export type LeaseEventType = (typeof LEASE_EVENT_TYPES)[keyof typeof LEASE_EVENT_TYPES];
export type ToolEventPayload = z.infer<typeof ToolEventPayloadSchema>;
