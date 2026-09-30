import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

const timestampWithTimeZone = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: timestampWithTimeZone("created_at").notNull(),
  updatedAt: timestampWithTimeZone("updated_at").notNull()
});

export const bots = pgTable("bots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  persona: text("persona").notNull(),
  createdAt: timestampWithTimeZone("created_at").notNull(),
  updatedAt: timestampWithTimeZone("updated_at").notNull()
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  botId: text("bot_id").notNull().references(() => bots.id),
  createdAt: timestampWithTimeZone("created_at").notNull(),
  updatedAt: timestampWithTimeZone("updated_at").notNull()
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    createdAt: timestampWithTimeZone("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    authorType: text("author_type").notNull(),
    content: text("content").notNull(),
    createdAt: timestampWithTimeZone("created_at").notNull()
  },
  (table) => [check("messages_author_type_check", sql`${table.authorType} IN ('user', 'assistant')`)]
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    botId: text("bot_id").notNull().references(() => bots.id),
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
    messageId: text("message_id").notNull().references(() => messages.id),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    pauseRequestedAt: timestampWithTimeZone("pause_requested_at"),
    retryCount: integer("retry_count").notNull().default(0),
    nextRetryAt: timestampWithTimeZone("next_retry_at"),
    lastEventSequence: integer("last_event_sequence").notNull().default(0),
    createdAt: timestampWithTimeZone("created_at").notNull(),
    updatedAt: timestampWithTimeZone("updated_at").notNull()
  },
  (table) => [
    check("tasks_status_check", sql`${table.status} IN ('queued', 'running', 'waiting_approval', 'paused', 'uncertain', 'completed', 'failed', 'cancelled')`),
    check("tasks_retry_count_check", sql`${table.retryCount} >= 0`),
    check("tasks_last_event_sequence_check", sql`${table.lastEventSequence} >= 0`)
  ]
);

export const taskCheckpoints = pgTable(
  "task_checkpoints",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    version: integer("version").notNull(),
    stateJson: jsonb("state_json").notNull(),
    createdAt: timestampWithTimeZone("created_at").notNull()
  },
  (table) => [uniqueIndex("task_checkpoints_task_id_version_key").on(table.taskId, table.version)]
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    turn: integer("turn").notNull(),
    attempt: integer("attempt").notNull(),
    actionJson: jsonb("action_json").notNull(),
    risk: text("risk").notNull(),
    status: text("status").notNull(),
    observation: text("observation"),
    errorCode: text("error_code"),
    createdAt: timestampWithTimeZone("created_at").notNull(),
    updatedAt: timestampWithTimeZone("updated_at").notNull()
  },
  (table) => [uniqueIndex("tool_calls_task_turn_attempt_key").on(table.taskId, table.turn, table.attempt)]
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestampWithTimeZone("created_at").notNull()
  },
  (table) => [
    uniqueIndex("task_events_task_id_sequence_key").on(table.taskId, table.sequence),
    check("task_events_sequence_check", sql`${table.sequence} > 0`)
  ]
);

export const routines = pgTable(
  "routines",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    botId: text("bot_id").notNull().references(() => bots.id),
    conversationId: text("conversation_id").notNull().unique().references(() => conversations.id),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    triggerType: text("trigger_type").notNull(),
    cronExpression: text("cron_expression"),
    runAt: timestampWithTimeZone("run_at"),
    timezone: text("timezone").notNull(),
    status: text("status").notNull(),
    nextRunAt: timestampWithTimeZone("next_run_at"),
    lastRunAt: timestampWithTimeZone("last_run_at"),
    lastRunStatus: text("last_run_status"),
    version: integer("version").notNull().default(1),
    deletedAt: timestampWithTimeZone("deleted_at"),
    createdAt: timestampWithTimeZone("created_at").notNull(),
    updatedAt: timestampWithTimeZone("updated_at").notNull()
  },
  (table) => [
    check("routines_trigger_type_check", sql`${table.triggerType} IN ('once', 'cron')`),
    check("routines_status_check", sql`${table.status} IN ('active', 'paused', 'completed', 'error', 'deleted')`),
    check("routines_version_check", sql`${table.version} > 0`),
    index("routines_due_idx").on(table.nextRunAt, table.id)
  ]
);

export const routineRuns = pgTable(
  "routine_runs",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id").notNull().references(() => routines.id),
    userId: text("user_id").notNull().references(() => users.id),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    scheduledFor: timestampWithTimeZone("scheduled_for").notNull(),
    claimedAt: timestampWithTimeZone("claimed_at").notNull(),
    status: text("status").notNull(),
    missedCount: integer("missed_count").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestampWithTimeZone("created_at").notNull(),
    updatedAt: timestampWithTimeZone("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("routine_runs_schedule_unique").on(table.routineId, table.scheduledFor),
    uniqueIndex("routine_runs_task_unique").on(table.taskId),
    index("routine_runs_history_idx").on(table.routineId, table.createdAt, table.id),
    check("routine_runs_missed_count_check", sql`${table.missedCount} >= 0`)
  ]
);
