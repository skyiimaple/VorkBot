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

export const FileListActionSchema = z
  .object({ type: z.literal("file.list"), path: z.string().trim().max(512).optional() })
  .strict();

export const FileStatActionSchema = z.object({ type: z.literal("file.stat"), path: TrimmedPathSchema }).strict();
export const FileMkdirActionSchema = z.object({ type: z.literal("file.mkdir"), path: TrimmedPathSchema }).strict();
export const FileMoveActionSchema = z
  .object({ type: z.literal("file.move"), from: TrimmedPathSchema, to: TrimmedPathSchema })
  .strict();
export const FileDeleteActionSchema = z
  .object({ type: z.literal("file.delete"), path: TrimmedPathSchema, recursive: z.boolean().optional() })
  .strict();

export const BrowserNavigateActionSchema = z
  .object({ type: z.literal("browser.navigate"), url: z.string().trim().min(1).max(2048) })
  .strict();
export const BrowserObserveActionSchema = z.object({ type: z.literal("browser.observe") }).strict();
export const BrowserClickActionSchema = z
  .object({ type: z.literal("browser.click"), ref: z.string().trim().min(1).max(512) })
  .strict();
export const BrowserTypeActionSchema = z
  .object({
    type: z.literal("browser.type"),
    ref: z.string().trim().min(1).max(512),
    text: z.string().max(100_000)
  })
  .strict();
export const BrowserScrollActionSchema = z
  .object({ type: z.literal("browser.scroll"), deltaY: z.number().int().min(-100_000).max(100_000) })
  .strict();

const TerminalSessionIdSchema = z.string().trim().min(1).max(128);
export const TerminalStartActionSchema = z
  .object({ type: z.literal("terminal.start"), command: z.string().trim().min(1).max(20_000).optional() })
  .strict();
export const TerminalWriteActionSchema = z
  .object({ type: z.literal("terminal.write"), sessionId: TerminalSessionIdSchema, input: z.string().max(100_000) })
  .strict();
export const TerminalReadActionSchema = z
  .object({ type: z.literal("terminal.read"), sessionId: TerminalSessionIdSchema, cursor: z.number().int().nonnegative().optional() })
  .strict();
export const TerminalTerminateActionSchema = z
  .object({ type: z.literal("terminal.terminate"), sessionId: TerminalSessionIdSchema })
  .strict();

export const MemoryProposeActionSchema = z
  .object({
    type: z.literal("memory.propose"),
    kind: z.enum(["identity", "fact", "working"]),
    content: z.string().trim().min(1).max(4000),
    sensitivity: z.enum(["normal", "sensitive"]).default("normal")
  })
  .strict();

/** 模型每轮只能返回其中一个动作（阶段 3：消息、文件、记忆建议） */
export const AgentActionSchema = z.discriminatedUnion("type", [
  MessageReplyActionSchema,
  TaskCompleteActionSchema,
  TaskFailActionSchema,
  FileWriteActionSchema,
  FileReadActionSchema,
  FileListActionSchema,
  FileStatActionSchema,
  FileMkdirActionSchema,
  FileMoveActionSchema,
  FileDeleteActionSchema,
  BrowserNavigateActionSchema,
  BrowserObserveActionSchema,
  BrowserClickActionSchema,
  BrowserTypeActionSchema,
  BrowserScrollActionSchema,
  TerminalStartActionSchema,
  TerminalWriteActionSchema,
  TerminalReadActionSchema,
  TerminalTerminateActionSchema,
  MemoryProposeActionSchema
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

export const ToolCallRiskSchema = z.enum(["safe", "side_effect"]);
export const ToolCallStatusSchema = z.enum(["prepared", "executing", "succeeded", "failed", "uncertain"]);

export const ToolCallSchema = z
  .object({
    id: z.string().trim().min(1),
    taskId: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    turn: z.number().int().nonnegative(),
    attempt: z.number().int().nonnegative(),
    action: AgentActionSchema,
    risk: ToolCallRiskSchema,
    status: ToolCallStatusSchema,
    observation: z.string().max(4000).nullable(),
    errorCode: z.string().trim().min(1).max(64).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
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
export type AgentToolAction = Exclude<
  AgentAction,
  { type: "message.reply" | "task.complete" | "task.fail" | "memory.propose" }
>;
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;
export type AgentActionEventPayload = z.infer<typeof AgentActionEventPayloadSchema>;
export type BudgetExceededEventPayload = z.infer<typeof BudgetExceededEventPayloadSchema>;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[keyof typeof AGENT_EVENT_TYPES];
export type ToolCallRisk = z.infer<typeof ToolCallRiskSchema>;
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
