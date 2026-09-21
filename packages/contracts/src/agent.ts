import { z } from "zod";

/** 阶段 3 Agent 循环事件 */
export const AGENT_EVENT_TYPES = {
  ACTION: "agent.action",
  BUDGET_EXCEEDED: "budget.exceeded"
} as const;

const TrimmedPathSchema = z.string().trim().min(1).max(512);

export const MessageReplyActionSchema = z
  .object({
    type: z.literal("message.reply"),
    text: z.string().min(1).max(100_000)
  })
  .strict();

export const TaskCompleteActionSchema = z.object({ type: z.literal("task.complete") }).strict();

export const TaskFailActionSchema = z
  .object({
    type: z.literal("task.fail"),
    errorCode: z.string().trim().min(1).max(64).default("AGENT_FAILED"),
    message: z.string().max(2000).optional()
  })
  .strict();

export const FileWriteActionSchema = z
  .object({
    type: z.literal("file.write"),
    path: TrimmedPathSchema,
    content: z.string().max(1_048_576)
  })
  .strict();

export const FileReadActionSchema = z
  .object({
    type: z.literal("file.read"),
    path: TrimmedPathSchema
  })
  .strict();

/** 模型每轮只能返回其中一个动作（阶段 3 首批：消息 + 文件） */
export const AgentActionSchema = z.discriminatedUnion("type", [
  MessageReplyActionSchema,
  TaskCompleteActionSchema,
  TaskFailActionSchema,
  FileWriteActionSchema,
  FileReadActionSchema
]);

export const TaskBudgetSchema = z
  .object({
    maxModelTurns: z.number().int().positive().max(200),
    maxToolCalls: z.number().int().positive().max(500),
    maxDurationMs: z.number().int().positive().max(3_600_000)
  })
  .strict();

/** 本地开发默认预算：足够跑通短文件序列，避免失控循环 */
export const DEFAULT_TASK_BUDGET = {
  maxModelTurns: 12,
  maxToolCalls: 20,
  maxDurationMs: 120_000
} as const satisfies z.infer<typeof TaskBudgetSchema>;

export const AgentActionEventPayloadSchema = z
  .object({
    actionType: z.string().min(1),
    turn: z.number().int().nonnegative()
  })
  .strict();

export const BudgetExceededEventPayloadSchema = z
  .object({
    reason: z.enum(["max_model_turns", "max_tool_calls", "max_duration_ms"]),
    budget: TaskBudgetSchema,
    modelTurns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative()
  })
  .strict();

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;
export type AgentActionEventPayload = z.infer<typeof AgentActionEventPayloadSchema>;
export type BudgetExceededEventPayload = z.infer<typeof BudgetExceededEventPayloadSchema>;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[keyof typeof AGENT_EVENT_TYPES];
