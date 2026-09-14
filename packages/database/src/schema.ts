import { sql } from "drizzle-orm";
import {
  check,
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
    lastEventSequence: integer("last_event_sequence").notNull().default(0),
    createdAt: timestampWithTimeZone("created_at").notNull(),
    updatedAt: timestampWithTimeZone("updated_at").notNull()
  },
  (table) => [
    check("tasks_status_check", sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`),
    check("tasks_last_event_sequence_check", sql`${table.lastEventSequence} >= 0`)
  ]
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
