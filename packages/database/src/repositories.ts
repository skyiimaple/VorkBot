import { nanoid } from "nanoid";
import type { Bot, Conversation, Message, Task, TaskEvent } from "../../contracts/src/index.js";
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

export type CreateBotRepositoryInput = {
  userId: string;
  name: string;
  persona: string;
};

export type CreateConversationRepositoryInput = {
  userId: string;
  botId: string;
};

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

export type AppendTaskEventRepositoryInput = {
  taskId: string;
  type: string;
  payload: unknown;
};

export type CompleteTaskWithMessageRepositoryInput = {
  taskId: string;
  content: string;
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

    async createBot(input: CreateBotRepositoryInput): Promise<Bot> {
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
      return toBot(required(rows, "Bot could not be created"));
    },

    async listBots(userId: string): Promise<Bot[]> {
      const rows = await sql<BotRow[]>`
        SELECT id, user_id, name, persona, created_at, updated_at
        FROM bots
        WHERE user_id = ${userId}
        ORDER BY created_at ASC, id ASC
      `;
      return rows.map(toBot);
    },

    async createConversation(input: CreateConversationRepositoryInput): Promise<Conversation> {
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
        return toConversation(conversation);
      });
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

    async getTask(taskId: string): Promise<Task | null> {
      const rows = await sql<TaskRow[]>`
        SELECT id, user_id, bot_id, conversation_id, message_id, status, last_event_sequence, created_at, updated_at
        FROM tasks WHERE id = ${taskId}
      `;
      return rows[0] ? toTask(rows[0]) : null;
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

    async failTask(taskId: string, errorCode: string): Promise<Task> {
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
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${id("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.failed', ${JSON.stringify({ errorCode })}::jsonb, ${now})
        `;
        return toTask(required(updatedRows, "Task could not be failed"));
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
    }
  };
}
