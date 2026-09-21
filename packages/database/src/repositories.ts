import { nanoid } from "nanoid";
import {
  BotSchema,
  ConversationSchema,
  CreateBotRepositoryInputSchema,
  CreateConversationRepositoryInputSchema,
  CreateQueuedMessageTaskInputSchema,
  GetBotInputSchema,
  GetConversationInputSchema,
  ListConversationsInputSchema,
  ListBotsInputSchema,
  ListMessagesInputSchema,
  ListTasksInputSchema,
  MessageSchema,
  QueuedMessageTaskResultSchema
} from "@vork/contracts";
import type {
  Bot,
  Conversation,
  CreateBotRepositoryInput as ContractCreateBotRepositoryInput,
  CreateConversationRepositoryInput as ContractCreateConversationRepositoryInput,
  CreateQueuedMessageTaskInput,
  Message,
  Task,
  TaskEvent
} from "@vork/contracts";
import { createDatabaseClient, type DatabaseClientOptions } from "./client.js";

type DateValue = Date | string;

type BotRow = {
  id: string;
  user_id: string;
  name: string;
  persona: string;
  created_at: DateValue;
  updated_at: DateValue;
};

type ConversationRow = {
  id: string;
  user_id: string;
  bot_id: string;
  created_at: DateValue;
  updated_at: DateValue;
};

type MessageRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  author_type: "user" | "assistant";
  content: string;
  created_at: DateValue;
};

type TaskRow = {
  id: string;
  user_id: string;
  bot_id: string;
  conversation_id: string;
  message_id: string;
  status: Task["status"];
  last_event_sequence: number;
  created_at: DateValue;
  updated_at: DateValue;
};

type TaskEventRow = {
  id: string;
  task_id: string;
  user_id: string;
  sequence: number;
  type: string;
  payload: unknown;
  created_at: DateValue;
};

export type CreateBotRepositoryInput = ContractCreateBotRepositoryInput;

export type CreateConversationRepositoryInput = ContractCreateConversationRepositoryInput;

export type AppendMessageRepositoryInput = {
  conversationId: string;
  authorType: Message["authorType"];
  content: string;
};

export type CreateTaskRepositoryInput = {
  userId: string;
  botId: string;
  conversationId: string;
  messageId: string;
};

export type CreateQueuedMessageTaskRepositoryInput = CreateQueuedMessageTaskInput;

export type AppendTaskEventRepositoryInput = {
  taskId: string;
  type: string;
  payload: unknown;
};

export type CompleteTaskWithMessageRepositoryInput = {
  taskId: string;
  content: string;
};

export type TaskWithMessagePreview = {
  task: Task;
  messageContent: string;
};

export type Repositories = ReturnType<typeof createRepositories>;

const terminalTaskStatuses: Task["status"][] = ["completed", "failed", "cancelled"];

function id(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

function iso(value: DateValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    persona: row.persona,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    authorType: row.author_type,
    content: row.content,
    createdAt: iso(row.created_at)
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    sequence: row.sequence,
    type: row.type,
    payload: row.payload,
    createdAt: iso(row.created_at)
  };
}

function required<Row>(rows: Row[], message: string): Row {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}

export function createRepositories(options: DatabaseClientOptions = {}) {
  const client = createDatabaseClient(options);
  const { sql } = client;

  return {
    close: client.close,

    async createBot(rawInput: CreateBotRepositoryInput): Promise<Bot> {
      const input = CreateBotRepositoryInputSchema.parse(rawInput);
      const now = new Date().toISOString();
      await sql`
        INSERT INTO users (id, created_at, updated_at)
        VALUES (${input.userId}, ${now}, ${now})
        ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at
      `;
      const rows = await sql<BotRow[]>`
        INSERT INTO bots (id, user_id, name, persona, created_at, updated_at)
        VALUES (${id("bot")}, ${input.userId}, ${input.name}, ${input.persona}, ${now}, ${now})
        RETURNING id, user_id, name, persona, created_at, updated_at
      `;
      return BotSchema.parse(toBot(required(rows, "Bot could not be created")));
    },

    async listBots(userId: string): Promise<Bot[]> {
      const input = ListBotsInputSchema.parse({ userId });
      const rows = await sql<BotRow[]>`
        SELECT id, user_id, name, persona, created_at, updated_at
        FROM bots
        WHERE user_id = ${input.userId}
        ORDER BY created_at ASC, id ASC
      `;
      return rows.map((row) => BotSchema.parse(toBot(row)));
    },

    async createConversation(rawInput: unknown): Promise<Conversation> {
      const input = CreateConversationRepositoryInputSchema.parse(rawInput);
      const botRows = await sql<{ id: string }[]>`
        SELECT id FROM bots WHERE id = ${input.botId} AND user_id = ${input.userId}
      `;
      required(botRows, "Bot does not belong to the conversation user");

      const now = new Date().toISOString();
      return sql.begin(async (transaction) => {
        const rows = await transaction<ConversationRow[]>`
          INSERT INTO conversations (id, user_id, bot_id, created_at, updated_at)
          VALUES (${id("conversation")}, ${input.userId}, ${input.botId}, ${now}, ${now})
          RETURNING id, user_id, bot_id, created_at, updated_at
        `;
        const conversation = required(rows, "Conversation could not be created");
        await transaction`
          INSERT INTO conversation_members (conversation_id, user_id, created_at)
          VALUES (${conversation.id}, ${input.userId}, ${now})
        `;
        return ConversationSchema.parse(toConversation(conversation));
      });
    },

    async getBot(rawInput: unknown): Promise<Bot | null> {
      const input = GetBotInputSchema.parse(rawInput);
      const rows = await sql<BotRow[]>`
        SELECT id, user_id, name, persona, created_at, updated_at
        FROM bots
        WHERE id = ${input.botId} AND user_id = ${input.userId}
      `;
      return rows[0] ? BotSchema.parse(toBot(rows[0])) : null;
    },

    async getConversation(rawInput: unknown): Promise<Conversation | null> {
      const input = GetConversationInputSchema.parse(rawInput);
      const rows = await sql<ConversationRow[]>`
        SELECT id, user_id, bot_id, created_at, updated_at
        FROM conversations
        WHERE id = ${input.conversationId} AND user_id = ${input.userId}
      `;
      return rows[0] ? ConversationSchema.parse(toConversation(rows[0])) : null;
    },

    async listConversations(userId: string): Promise<Conversation[]> {
      const input = ListConversationsInputSchema.parse({ userId });
      const rows = await sql<ConversationRow[]>`
        SELECT id, user_id, bot_id, created_at, updated_at
        FROM conversations
        WHERE user_id = ${input.userId}
        ORDER BY updated_at DESC, id DESC
      `;
      return rows.map((row) => ConversationSchema.parse(toConversation(row)));
    },

    async appendMessage(input: AppendMessageRepositoryInput): Promise<Message> {
      const conversationRows = await sql<{ user_id: string }[]>`
        SELECT user_id FROM conversations WHERE id = ${input.conversationId}
      `;
      const conversation = required(conversationRows, "Conversation does not exist");
      const now = new Date().toISOString();
      const rows = await sql<MessageRow[]>`
        INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
        VALUES (${id("message")}, ${conversation.user_id}, ${input.conversationId}, ${input.authorType}, ${input.content}, ${now})
        RETURNING id, user_id, conversation_id, author_type, content, created_at
      `;
      return toMessage(required(rows, "Message could not be appended"));
    },

    async listMessages(rawInput: unknown): Promise<Message[]> {
      const input = ListMessagesInputSchema.parse(rawInput);
      const rows = await sql<MessageRow[]>`
        SELECT messages.id, messages.user_id, messages.conversation_id, messages.author_type, messages.content, messages.created_at
        FROM messages
        INNER JOIN conversations ON conversations.id = messages.conversation_id
        WHERE messages.conversation_id = ${input.conversationId} AND conversations.user_id = ${input.userId}
        ORDER BY messages.created_at ASC, messages.id ASC
      `;
      return rows.map((row) => MessageSchema.parse(toMessage(row)));
    },

    async createTask(input: CreateTaskRepositoryInput): Promise<Task> {
      const ownershipRows = await sql<{ id: string }[]>`
        SELECT conversations.id
        FROM conversations
        INNER JOIN bots ON bots.id = conversations.bot_id
        INNER JOIN messages ON messages.id = ${input.messageId}
        WHERE conversations.id = ${input.conversationId}
          AND conversations.user_id = ${input.userId}
          AND conversations.bot_id = ${input.botId}
          AND bots.user_id = ${input.userId}
          AND messages.conversation_id = conversations.id
          AND messages.user_id = ${input.userId}
      `;
      required(ownershipRows, "Task references resources outside its user ownership boundary");

      const now = new Date().toISOString();
      const rows = await sql<TaskRow[]>`
        INSERT INTO tasks (id, user_id, bot_id, conversation_id, message_id, status, created_at, updated_at)
        VALUES (${id("task")}, ${input.userId}, ${input.botId}, ${input.conversationId}, ${input.messageId}, 'queued', ${now}, ${now})
        RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
      `;
      return toTask(required(rows, "Task could not be created"));
    },

    async createQueuedMessageTask(rawInput: unknown): Promise<{ message: Message; task: Task; event: TaskEvent }> {
      const input = CreateQueuedMessageTaskInputSchema.parse(rawInput);
      return sql.begin(async (transaction) => {
        const ownershipRows = await transaction<{ id: string }[]>`
          SELECT conversations.id
          FROM conversations
          INNER JOIN bots ON bots.id = conversations.bot_id
          WHERE conversations.id = ${input.conversationId}
            AND conversations.user_id = ${input.userId}
            AND conversations.bot_id = ${input.botId}
            AND bots.user_id = ${input.userId}
          FOR SHARE
        `;
        required(ownershipRows, "Task references resources outside its user ownership boundary");

        const now = new Date().toISOString();
        const messageRows = await transaction<MessageRow[]>`
          INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
          VALUES (${id("message")}, ${input.userId}, ${input.conversationId}, 'user', ${input.content}, ${now})
          RETURNING id, user_id, conversation_id, author_type, content, created_at
        `;
        const message = required(messageRows, "Message could not be appended");
        const taskRows = await transaction<TaskRow[]>`
          INSERT INTO tasks (id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at)
          VALUES (${id("task")}, ${input.userId}, ${input.botId}, ${input.conversationId}, ${message.id}, 'queued', 1, ${now}, ${now})
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        const task = required(taskRows, "Task could not be created");
        const eventRows = await transaction<TaskEventRow[]>`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${input.userId}, 1, 'task.queued', ${JSON.stringify({})}::jsonb, ${now})
          RETURNING id, task_id, user_id, sequence, type, payload, created_at
        `;
        return QueuedMessageTaskResultSchema.parse({
          message: toMessage(message),
          task: toTask(task),
          event: toTaskEvent(required(eventRows, "Task event could not be appended"))
        });
      });
    },

    async getTask(taskId: string): Promise<Task | null> {
      const rows = await sql<TaskRow[]>`
        SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        FROM tasks WHERE id = ${taskId}
      `;
      return rows[0] ? toTask(rows[0]) : null;
    },

    async listTasks(userId: string, limit = 50): Promise<TaskWithMessagePreview[]> {
      const input = ListTasksInputSchema.parse({ userId, limit });
      const rows = await sql<(TaskRow & { message_content: string })[]>`
        SELECT
          tasks.id,
          tasks.user_id,
          tasks.bot_id,
          tasks.conversation_id,
          tasks.message_id,
          tasks.status,
          tasks.last_event_sequence,
          tasks.created_at,
          tasks.updated_at,
          messages.content AS message_content
        FROM tasks
        INNER JOIN messages ON messages.id = tasks.message_id
        WHERE tasks.user_id = ${input.userId}
        ORDER BY tasks.updated_at DESC, tasks.created_at DESC
        LIMIT ${input.limit ?? 50}
      `;
      return rows.map((row) => ({
        task: toTask(row),
        messageContent: row.message_content
      }));
    },

    async appendTaskEvent(input: AppendTaskEventRepositoryInput): Promise<TaskEvent> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${input.taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (terminalTaskStatuses.includes(task.status)) {
          throw new Error("Terminal tasks cannot accept additional events");
        }
        if (input.type === "task.running" && task.status !== "queued") {
          throw new Error("Only queued tasks can transition to running");
        }
        const sequence = task.last_event_sequence + 1;
        const status = input.type === "task.running" ? "running" : task.status;
        const now = new Date().toISOString();
        await transaction`
          UPDATE tasks
          SET status = ${status}, last_event_sequence = ${sequence}, updated_at = ${now}
          WHERE id = ${task.id}
        `;
        const eventRows = await transaction<TaskEventRow[]>`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, ${input.type}, ${JSON.stringify(input.payload)}::jsonb, ${now})
          RETURNING id, task_id, user_id, sequence, type, payload, created_at
        `;
        return toTaskEvent(required(eventRows, "Task event could not be appended"));
      });
    },

    async listTaskEvents(taskId: string, afterSequence: number): Promise<TaskEvent[]> {
      const rows = await sql<TaskEventRow[]>`
        SELECT id, task_id, user_id, sequence, type, payload, created_at
        FROM task_events
        WHERE task_id = ${taskId} AND sequence > ${afterSequence}
        ORDER BY sequence ASC
      `;
      return rows.map(toTaskEvent);
    },

    async failTask(taskId: string, errorCode: string, message?: string): Promise<Task> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (task.status === "failed") {
          return toTask(task);
        }
        if (terminalTaskStatuses.includes(task.status)) {
          throw new Error("Terminal tasks cannot be failed again");
        }
        const sequence = task.last_event_sequence + 1;
        const now = new Date().toISOString();
        const updatedRows = await transaction<TaskRow[]>`
          UPDATE tasks
          SET status = 'failed', error_code = ${errorCode}, last_event_sequence = ${sequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        const payload = message ? { errorCode, message } : { errorCode };
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.failed', ${JSON.stringify(payload)}::jsonb, ${now})
        `;
        return toTask(required(updatedRows, "Task could not be failed"));
      });
    },

    async failTaskWithMessage(input: { taskId: string; errorCode: string; content: string }): Promise<Task> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${input.taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (terminalTaskStatuses.includes(task.status)) {
          throw new Error("Terminal tasks cannot be failed again");
        }
        const now = new Date().toISOString();
        const messageRows = await transaction<MessageRow[]>`
          INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
          VALUES (${id("message")}, ${task.user_id}, ${task.conversation_id}, 'assistant', ${input.content}, ${now})
          RETURNING id, user_id, conversation_id, author_type, content, created_at
        `;
        const message = required(messageRows, "Failure message could not be appended");
        const deltaSequence = task.last_event_sequence + 1;
        const messageSequence = deltaSequence + 1;
        const failSequence = messageSequence + 1;
        const updatedRows = await transaction<TaskRow[]>`
          UPDATE tasks
          SET status = 'failed', error_code = ${input.errorCode}, last_event_sequence = ${failSequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${deltaSequence}, 'message.delta', ${JSON.stringify({ text: input.content })}::jsonb, ${now})
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${messageSequence}, 'message.completed', ${JSON.stringify({ messageId: message.id })}::jsonb, ${now})
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${id("event")}, ${task.id}, ${task.user_id}, ${failSequence}, 'task.failed',
            ${JSON.stringify({ errorCode: input.errorCode, message: input.content })}::jsonb, ${now}
          )
        `;
        return toTask(required(updatedRows, "Task could not be failed"));
      });
    },

    async cancelTask(taskId: string): Promise<Task> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (task.status === "cancelled") {
          return toTask(task);
        }
        if (terminalTaskStatuses.includes(task.status)) {
          throw new Error("Terminal tasks cannot be cancelled");
        }
        const sequence = task.last_event_sequence + 1;
        const now = new Date().toISOString();
        const updatedRows = await transaction<TaskRow[]>`
          UPDATE tasks
          SET status = 'cancelled', last_event_sequence = ${sequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.cancelled', ${JSON.stringify({})}::jsonb, ${now})
        `;
        return toTask(required(updatedRows, "Task could not be cancelled"));
      });
    },

    async completeTaskWithMessage(input: CompleteTaskWithMessageRepositoryInput): Promise<{ task: Task; message: Message }> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${input.taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (terminalTaskStatuses.includes(task.status)) {
          throw new Error("Terminal tasks cannot be completed again");
        }

        const now = new Date().toISOString();
        const messageRows = await transaction<MessageRow[]>`
          INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
          VALUES (${id("message")}, ${task.user_id}, ${task.conversation_id}, 'assistant', ${input.content}, ${now})
          RETURNING id, user_id, conversation_id, author_type, content, created_at
        `;
        const message = required(messageRows, "Completion message could not be appended");
        const completedSequence = task.last_event_sequence + 1;
        const taskSequence = completedSequence + 1;
        const updatedRows = await transaction<TaskRow[]>`
          UPDATE tasks
          SET status = 'completed', last_event_sequence = ${taskSequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        const payload = JSON.stringify({ messageId: message.id });
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${completedSequence}, 'message.completed', ${payload}::jsonb, ${now})
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${taskSequence}, 'task.completed', ${payload}::jsonb, ${now})
        `;
        return { task: toTask(required(updatedRows, "Task could not be completed")), message: toMessage(message) };
      });
    },

    async requestApproval(input: { taskId: string; reason: string; action: unknown }): Promise<Task> {
      return sql.begin(async (transaction) => {
        const taskRows = await transaction<TaskRow[]>`
          SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
          FROM tasks WHERE id = ${input.taskId} FOR UPDATE
        `;
        const task = required(taskRows, "Task does not exist");
        if (terminalTaskStatuses.includes(task.status) || task.status === "waiting_approval") {
          throw new Error("Task cannot request approval");
        }
        const now = new Date().toISOString();
        const approvalId = id("approval");
        await transaction`
          INSERT INTO approvals (id, task_id, user_id, reason, action, status, created_at)
          VALUES (${approvalId}, ${task.id}, ${task.user_id}, ${input.reason}, ${JSON.stringify(input.action)}::jsonb, 'pending', ${now})
        `;
        const sequence = task.last_event_sequence + 1;
        const updatedRows = await transaction<TaskRow[]>`
          UPDATE tasks
          SET status = 'waiting_approval', last_event_sequence = ${sequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'approval.request',
            ${JSON.stringify({ approvalId, reason: input.reason, actionType: actionTypeOf(input.action) })}::jsonb,
            ${now}
          )
        `;
        return toTask(required(updatedRows, "Task could not wait for approval"));
      });
    },

    async getPendingApproval(taskId: string): Promise<{ id: string; action: unknown; reason: string } | null> {
      const rows = await sql<{ id: string; action: unknown; reason: string }[]>`
        SELECT id, action, reason FROM approvals
        WHERE task_id = ${taskId} AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async claimApprovedActionForResume(
      taskId: string
    ): Promise<{ id: string; action: unknown; reason: string } | null> {
      return sql.begin(async (transaction) => {
        const rows = await transaction<{ id: string; action: unknown; reason: string }[]>`
          SELECT id, action, reason FROM approvals
          WHERE task_id = ${taskId} AND status = 'approved' AND executed_at IS NULL
          ORDER BY resolved_at DESC NULLS LAST, created_at DESC
          LIMIT 1
          FOR UPDATE
        `;
        const approval = rows[0];
        if (!approval) return null;
        const now = new Date().toISOString();
        await transaction`
          UPDATE approvals SET executed_at = ${now} WHERE id = ${approval.id}
        `;
        return approval;
      });
    },

    async resolveApproval(input: {
      taskId: string;
      decision: "approve" | "reject";
    }): Promise<{ task: Task; resume?: { approvalId: string } }> {
      const pending = await sql<{ id: string; action: unknown }[]>`
        SELECT id, action FROM approvals WHERE task_id = ${input.taskId} AND status = 'pending' ORDER BY created_at DESC LIMIT 1
      `;
      const approval = pending[0];
      if (!approval) throw new Error("No pending approval");
      const action = approval.action as {
        type?: string;
        kind?: string;
        content?: string;
        sensitivity?: string;
        path?: string;
      };
      const now = new Date().toISOString();

      if (input.decision === "reject") {
        await sql`
          UPDATE approvals SET status = 'rejected', resolved_at = ${now} WHERE id = ${approval.id}
        `;
        const taskRows = await sql<TaskRow[]>`SELECT id, user_id, last_event_sequence FROM tasks WHERE id = ${input.taskId}`;
        const task = required(taskRows, "Task does not exist");
        const sequence = task.last_event_sequence + 1;
        await sql`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${id("event")}, ${input.taskId}, ${task.user_id}, ${sequence}, 'approval.resolved',
            ${JSON.stringify({ approvalId: approval.id, decision: "reject" })}::jsonb, ${now}
          )
        `;
        await sql`UPDATE tasks SET last_event_sequence = ${sequence}, updated_at = ${now} WHERE id = ${input.taskId}`;
        const failed = await this.failTaskWithMessage({
          taskId: input.taskId,
          errorCode: "APPROVAL_REJECTED",
          content: rejectionMessageFor(action)
        });
        return { task: failed };
      }

      await sql`
        UPDATE approvals SET status = 'approved', resolved_at = ${now} WHERE id = ${approval.id}
      `;
      const taskRows = await sql<TaskRow[]>`
        SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        FROM tasks WHERE id = ${input.taskId}
      `;
      const task = required(taskRows, "Task does not exist");
      const sequence = task.last_event_sequence + 1;
      await sql`
        INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
        VALUES (
          ${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'approval.resolved',
          ${JSON.stringify({ approvalId: approval.id, decision: "approve" })}::jsonb, ${now}
        )
      `;
      await sql`UPDATE tasks SET last_event_sequence = ${sequence}, updated_at = ${now} WHERE id = ${task.id}`;

      if (action?.type === "memory.propose" && action.kind && action.content) {
        await this.insertMemory({
          userId: task.user_id,
          botId: task.bot_id,
          kind: action.kind,
          content: action.content,
          sensitivity: action.sensitivity === "sensitive" ? "sensitive" : "normal",
          sourceTaskId: task.id
        });
        const completed = (
          await this.completeTaskWithMessage({ taskId: task.id, content: "已批准并保存记忆。" })
        ).task;
        return { task: completed };
      }

      if (action?.type === "file.write" || action?.type === "file.read") {
        const queuedSequence = sequence + 1;
        const updatedRows = await sql<TaskRow[]>`
          UPDATE tasks
          SET status = 'queued', last_event_sequence = ${queuedSequence}, updated_at = ${now}
          WHERE id = ${task.id}
          RETURNING id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        `;
        await sql`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${id("event")}, ${task.id}, ${task.user_id}, ${queuedSequence}, 'task.queued',
            ${JSON.stringify({ reason: "approval_resume", approvalId: approval.id })}::jsonb, ${now}
          )
        `;
        return {
          task: toTask(required(updatedRows, "Task could not be requeued after approval")),
          resume: { approvalId: approval.id }
        };
      }

      throw new Error("APPROVAL_NOT_RESUMABLE");
    },

    async insertMemory(input: {
      userId: string;
      botId: string;
      kind: string;
      content: string;
      sensitivity: string;
      sourceTaskId?: string;
    }): Promise<{ id: string; created: boolean }> {
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM memories
        WHERE bot_id = ${input.botId} AND kind = ${input.kind} AND content = ${input.content} AND superseded_by IS NULL
        LIMIT 1
      `;
      if (existing[0]) return { id: existing[0].id, created: false };
      const now = new Date().toISOString();
      const memoryId = id("memory");
      await sql`
        INSERT INTO memories (id, user_id, bot_id, kind, content, sensitivity, source_task_id, created_at)
        VALUES (
          ${memoryId}, ${input.userId}, ${input.botId}, ${input.kind}, ${input.content}, ${input.sensitivity},
          ${input.sourceTaskId ?? null}, ${now}
        )
      `;
      return { id: memoryId, created: true };
    },

    async listMemories(input: { userId: string; botId: string }): Promise<Array<{ id: string; kind: string; content: string; sensitivity: string }>> {
      return sql`
        SELECT id, kind, content, sensitivity FROM memories
        WHERE user_id = ${input.userId} AND bot_id = ${input.botId} AND superseded_by IS NULL
        ORDER BY created_at ASC
      `;
    },

    async compressWorkingMemory(input: { userId: string; botId: string; taskId: string; content: string }): Promise<void> {
      const created = await this.insertMemory({
        userId: input.userId,
        botId: input.botId,
        kind: "working",
        content: input.content,
        sensitivity: "normal",
        sourceTaskId: input.taskId
      });
      await sql`
        UPDATE memories
        SET superseded_by = ${created.id}
        WHERE bot_id = ${input.botId} AND kind = 'working' AND superseded_by IS NULL AND id <> ${created.id}
      `;
    },

    async countCompletedTasks(botId: string): Promise<number> {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM tasks WHERE bot_id = ${botId} AND status = 'completed'
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async createSkillProposal(input: {
      userId: string;
      botId: string;
      taskId: string;
      name: string;
      summary: string;
    }): Promise<{ id: string; status: "draft" }> {
      const now = new Date().toISOString();
      const proposalId = id("skill");
      await sql`
        INSERT INTO skill_proposals (id, user_id, bot_id, task_id, name, summary, status, created_at)
        VALUES (${proposalId}, ${input.userId}, ${input.botId}, ${input.taskId}, ${input.name}, ${input.summary}, 'draft', ${now})
      `;
      return { id: proposalId, status: "draft" };
    },

    async listSkillProposals(userId: string): Promise<Array<{ id: string; name: string; summary: string; createdAt: string }>> {
      const rows = await sql<{ id: string; name: string; summary: string; created_at: DateValue }[]>`
        SELECT id, name, summary, created_at FROM skill_proposals
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        createdAt: iso(row.created_at)
      }));
    },

    async upsertModelCredential(input: {
      userId: string;
      provider: string;
      apiKey: string;
      baseUrl?: string;
      model?: string;
    }): Promise<void> {
      const now = new Date().toISOString();
      await sql`
        INSERT INTO users (id, created_at, updated_at)
        VALUES (${input.userId}, ${now}, ${now})
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO model_credentials (id, user_id, provider, api_key, base_url, model, updated_at)
        VALUES (${id("credential")}, ${input.userId}, ${input.provider}, ${input.apiKey}, ${input.baseUrl ?? null}, ${input.model ?? null}, ${now})
        ON CONFLICT (user_id, provider) DO UPDATE
        SET api_key = EXCLUDED.api_key, base_url = EXCLUDED.base_url, model = EXCLUDED.model, updated_at = EXCLUDED.updated_at
      `;
    },

    async getModelCredential(userId: string): Promise<{ provider: string; apiKey: string; baseUrl: string | null; model: string | null } | null> {
      const rows = await sql<{ provider: string; api_key: string; base_url: string | null; model: string | null }[]>`
        SELECT provider, api_key, base_url, model FROM model_credentials
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return { provider: row.provider, apiKey: row.api_key, baseUrl: row.base_url, model: row.model };
    },

    async deleteModelCredential(userId: string, provider = "openai-compatible"): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM model_credentials
        WHERE user_id = ${userId} AND provider = ${provider}
        RETURNING id
      `;
      return rows.length > 0;
    }
  };
}

function actionTypeOf(action: unknown): string {
  if (action && typeof action === "object" && "type" in action && typeof action.type === "string") return action.type;
  return "unknown";
}

function rejectionMessageFor(action: { type?: string; path?: string }): string {
  if (action?.type === "file.write" && action.path) {
    return `你已拒绝写入「${action.path}」，任务已结束。`;
  }
  if (action?.type === "file.read" && action.path) {
    return `你已拒绝读取「${action.path}」，任务已结束。`;
  }
  if (action?.type === "memory.propose") {
    return "你已拒绝保存敏感记忆，任务已结束。";
  }
  return "你已拒绝该操作，任务已结束。";
}
