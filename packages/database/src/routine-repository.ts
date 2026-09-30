import { nanoid } from "nanoid";
import {
  CreateRoutineInputSchema,
  RoutineRunSchema,
  RoutineSchema,
  UpdateRoutineInputSchema
} from "@vork/contracts";
import type {
  Conversation,
  CreateRoutineInput,
  Routine,
  RoutineRun,
  RoutineTrigger,
  TaskJob,
  UpdateRoutineInput
} from "@vork/contracts";
import type { createDatabaseClient } from "./client.js";
import { advanceDueSchedule, calculateNextRun } from "./routine-schedule.js";

type Sql = ReturnType<typeof createDatabaseClient>["sql"];
type DateValue = Date | string;

type RoutineRow = {
  id: string;
  user_id: string;
  bot_id: string;
  conversation_id: string;
  name: string;
  prompt: string;
  trigger_type: "once" | "cron";
  cron_expression: string | null;
  run_at: DateValue | null;
  timezone: string;
  status: Routine["status"];
  next_run_at: DateValue | null;
  last_run_at: DateValue | null;
  last_run_status: RoutineRun["status"] | null;
  version: number;
  created_at: DateValue;
  updated_at: DateValue;
};

type RoutineRunRow = {
  id: string;
  routine_id: string;
  user_id: string;
  scheduled_for: DateValue;
  claimed_at: DateValue;
  task_id: string | null;
  status: RoutineRun["status"];
  missed_count: number;
  error_code: string | null;
  created_at: DateValue;
  updated_at: DateValue;
};

export type CreateRoutineRepositoryInput = CreateRoutineInput & {
  userId: string;
  now?: string;
};

export type RoutineDispatch = {
  run: RoutineRun;
  taskJob: TaskJob | null;
};

export class RoutineActiveTaskError extends Error {
  constructor(readonly run: RoutineRun) {
    super("ROUTINE_ACTIVE_TASK");
    this.name = "RoutineActiveTaskError";
  }
}

function id(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

function iso(value: DateValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function triggerFrom(row: RoutineRow): RoutineTrigger {
  return row.trigger_type === "once"
    ? { type: "once", runAt: iso(row.run_at!) }
    : { type: "cron", expression: row.cron_expression! };
}

function toRoutine(row: RoutineRow): Routine {
  return RoutineSchema.parse({
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    conversationId: row.conversation_id,
    name: row.name,
    prompt: row.prompt,
    trigger: triggerFrom(row),
    timezone: row.timezone,
    status: row.status,
    nextRunAt: row.next_run_at ? iso(row.next_run_at) : null,
    lastRunAt: row.last_run_at ? iso(row.last_run_at) : null,
    lastRunStatus: row.last_run_status,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

function toRoutineRun(row: RoutineRunRow): RoutineRun {
  return RoutineRunSchema.parse({
    id: row.id,
    routineId: row.routine_id,
    userId: row.user_id,
    scheduledFor: iso(row.scheduled_for),
    claimedAt: iso(row.claimed_at),
    taskId: row.task_id,
    status: row.status,
    missedCount: row.missed_count,
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

const routineColumns = `
  id, user_id, bot_id, conversation_id, name, prompt, trigger_type,
  cron_expression, run_at, timezone, status, next_run_at, last_run_at,
  last_run_status, version, created_at, updated_at
`;

const runColumns = `
  id, routine_id, user_id, scheduled_for, claimed_at, task_id, status,
  missed_count, error_code, created_at, updated_at
`;

export function createRoutineRepository(sql: Sql) {
  return {
    async createRoutineWithConversation(rawInput: CreateRoutineRepositoryInput): Promise<{
      routine: Routine;
      conversation: Conversation;
    }> {
      const input = CreateRoutineInputSchema.parse({
        name: rawInput.name,
        botId: rawInput.botId,
        prompt: rawInput.prompt,
        trigger: rawInput.trigger,
        timezone: rawInput.timezone
      });
      const now = rawInput.now ? new Date(rawInput.now) : new Date();
      const nowIso = now.toISOString();
      const nextRunAt = calculateNextRun(input.trigger, input.timezone, now);

      return sql.begin(async (tx) => {
        const bots = await tx<{ id: string }[]>`
          SELECT id FROM bots WHERE id = ${input.botId} AND user_id = ${rawInput.userId} FOR SHARE
        `;
        if (!bots[0]) throw new Error("ROUTINE_BOT_NOT_FOUND");

        const conversationId = id("conversation");
        const conversationRows = await tx<{
          id: string; user_id: string; bot_id: string; created_at: DateValue; updated_at: DateValue;
        }[]>`
          INSERT INTO conversations (id, user_id, bot_id, created_at, updated_at)
          VALUES (${conversationId}, ${rawInput.userId}, ${input.botId}, ${nowIso}, ${nowIso})
          RETURNING id, user_id, bot_id, created_at, updated_at
        `;
        await tx`
          INSERT INTO conversation_members (conversation_id, user_id, created_at)
          VALUES (${conversationId}, ${rawInput.userId}, ${nowIso})
        `;

        const rows = await tx.unsafe<RoutineRow[]>(`
          INSERT INTO routines (
            id, user_id, bot_id, conversation_id, name, prompt, trigger_type,
            cron_expression, run_at, timezone, status, next_run_at, version,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, 1, $12, $12)
          RETURNING ${routineColumns}
        `, [
          id("routine"), rawInput.userId, input.botId, conversationId, input.name, input.prompt,
          input.trigger.type,
          input.trigger.type === "cron" ? input.trigger.expression : null,
          input.trigger.type === "once" ? input.trigger.runAt : null,
          input.timezone, nextRunAt, nowIso
        ]);
        const routine = rows[0];
        const conversation = conversationRows[0];
        if (!routine || !conversation) throw new Error("ROUTINE_CREATE_FAILED");
        return {
          routine: toRoutine(routine),
          conversation: {
            id: conversation.id,
            userId: conversation.user_id,
            botId: conversation.bot_id,
            createdAt: iso(conversation.created_at),
            updatedAt: iso(conversation.updated_at)
          }
        };
      });
    },

    async getRoutine(routineId: string, userId: string): Promise<Routine | null> {
      const rows = await sql.unsafe<RoutineRow[]>(`
        SELECT ${routineColumns} FROM routines
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      `, [routineId, userId]);
      return rows[0] ? toRoutine(rows[0]) : null;
    },

    async listRoutines(userId: string): Promise<Routine[]> {
      const rows = await sql.unsafe<RoutineRow[]>(`
        SELECT ${routineColumns} FROM routines
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
      `, [userId]);
      return rows.map(toRoutine);
    },

    async updateRoutine(
      routineId: string,
      userId: string,
      rawInput: UpdateRoutineInput,
      nowValue = new Date().toISOString()
    ): Promise<Routine> {
      const input = UpdateRoutineInputSchema.parse(rawInput);
      const now = new Date(nowValue);
      return sql.begin(async (tx) => {
        const currentRows = await tx.unsafe<RoutineRow[]>(`
          SELECT ${routineColumns} FROM routines
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
        `, [routineId, userId]);
        const current = currentRows[0];
        if (!current) throw new Error("ROUTINE_NOT_FOUND");
        if (current.version !== input.version) throw new Error("ROUTINE_VERSION_CONFLICT");
        const bots = await tx<{ id: string }[]>`
          SELECT id FROM bots WHERE id = ${input.botId} AND user_id = ${userId} FOR SHARE
        `;
        if (!bots[0]) throw new Error("ROUTINE_BOT_NOT_FOUND");
        const nextRunAt = current.status === "active"
          ? calculateNextRun(input.trigger, input.timezone, now)
          : null;
        const rows = await tx.unsafe<RoutineRow[]>(`
          UPDATE routines SET
            bot_id = $1, name = $2, prompt = $3, trigger_type = $4,
            cron_expression = $5, run_at = $6, timezone = $7, next_run_at = $8,
            version = version + 1, updated_at = $9
          WHERE id = $10 AND version = $11
          RETURNING ${routineColumns}
        `, [
          input.botId, input.name, input.prompt, input.trigger.type,
          input.trigger.type === "cron" ? input.trigger.expression : null,
          input.trigger.type === "once" ? input.trigger.runAt : null,
          input.timezone, nextRunAt, now.toISOString(), routineId, input.version
        ]);
        if (!rows[0]) throw new Error("ROUTINE_VERSION_CONFLICT");
        await tx`
          UPDATE conversations SET bot_id = ${input.botId}, updated_at = ${now.toISOString()}
          WHERE id = ${current.conversation_id}
        `;
        return toRoutine(rows[0]);
      });
    },

    async setRoutineEnabled(
      routineId: string,
      userId: string,
      enabled: boolean,
      nowValue = new Date().toISOString()
    ): Promise<Routine> {
      return sql.begin(async (tx) => {
        const currentRows = await tx.unsafe<RoutineRow[]>(`
          SELECT ${routineColumns} FROM routines
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
        `, [routineId, userId]);
        const current = currentRows[0];
        if (!current) throw new Error("ROUTINE_NOT_FOUND");
        const now = new Date(nowValue);
        const nextRunAt = enabled ? calculateNextRun(triggerFrom(current), current.timezone, now) : null;
        const rows = await tx.unsafe<RoutineRow[]>(`
          UPDATE routines SET status = $1, next_run_at = $2, version = version + 1, updated_at = $3
          WHERE id = $4
          RETURNING ${routineColumns}
        `, [enabled ? "active" : "paused", nextRunAt, now.toISOString(), routineId]);
        return toRoutine(rows[0]!);
      });
    },

    async softDeleteRoutine(
      routineId: string,
      userId: string,
      nowValue = new Date().toISOString()
    ): Promise<Routine> {
      const rows = await sql.unsafe<RoutineRow[]>(`
        UPDATE routines
        SET status = 'deleted', next_run_at = NULL, deleted_at = $1,
            version = version + 1, updated_at = $1
        WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
        RETURNING ${routineColumns}
      `, [new Date(nowValue).toISOString(), routineId, userId]);
      if (!rows[0]) throw new Error("ROUTINE_NOT_FOUND");
      return toRoutine(rows[0]);
    },

    async claimDueRoutineRuns(nowValue: string, limit: number): Promise<RoutineDispatch[]> {
      const now = new Date(nowValue);
      const nowIso = now.toISOString();
      return sql.begin(async (tx) => {
        const due = await tx.unsafe<RoutineRow[]>(`
          SELECT ${routineColumns} FROM routines
          WHERE status = 'active' AND deleted_at IS NULL AND next_run_at <= $1
          ORDER BY next_run_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        `, [nowIso, limit]);
        const dispatches: RoutineDispatch[] = [];

        for (const routine of due) {
          const scheduledFor = iso(routine.next_run_at!);
          const advance = advanceDueSchedule(triggerFrom(routine), routine.timezone, new Date(scheduledFor), now);
          const active = await tx<{ id: string }[]>`
            SELECT id FROM tasks
            WHERE conversation_id = ${routine.conversation_id}
              AND status IN ('queued', 'running', 'waiting_approval', 'paused', 'uncertain')
            LIMIT 1
          `;
          const runId = id("routine_run");
          let status: RoutineRun["status"] = "skipped_overlap";
          let taskId: string | null = null;
          let taskJob: TaskJob | null = null;

          if (!active[0]) {
            const messageId = id("message");
            taskId = id("task");
            await tx`
              INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
              VALUES (${messageId}, ${routine.user_id}, ${routine.conversation_id}, 'user', ${routine.prompt}, ${nowIso})
            `;
            await tx`
              INSERT INTO tasks (
                id, user_id, bot_id, conversation_id, message_id, status,
                last_event_sequence, created_at, updated_at
              ) VALUES (
                ${taskId}, ${routine.user_id}, ${routine.bot_id}, ${routine.conversation_id},
                ${messageId}, 'queued', 1, ${nowIso}, ${nowIso}
              )
            `;
            await tx`
              INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
              VALUES (${id("event")}, ${taskId}, ${routine.user_id}, 1, 'task.queued', ${JSON.stringify({ source: "routine", routineRunId: runId })}::jsonb, ${nowIso})
            `;
            status = "queued";
            taskJob = {
              taskId,
              userId: routine.user_id,
              botId: routine.bot_id,
              conversationId: routine.conversation_id,
              messageId
            };
          }

          const runRows = await tx.unsafe<RoutineRunRow[]>(`
            INSERT INTO routine_runs (
              id, routine_id, user_id, scheduled_for, claimed_at, task_id, status,
              missed_count, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $5)
            RETURNING ${runColumns}
          `, [runId, routine.id, routine.user_id, scheduledFor, nowIso, taskId, status, advance.missedCount]);

          const nextStatus = routine.trigger_type === "once" ? "completed" : "active";
          await tx`
            UPDATE routines
            SET status = ${nextStatus}, next_run_at = ${advance.nextRunAt},
                last_run_at = ${scheduledFor}, last_run_status = ${status},
                version = version + 1, updated_at = ${nowIso}
            WHERE id = ${routine.id}
          `;
          dispatches.push({ run: toRoutineRun(runRows[0]!), taskJob });
        }
        return dispatches;
      });
    },

    async runRoutineNow(
      routineId: string,
      userId: string,
      nowValue = new Date().toISOString()
    ): Promise<RoutineDispatch> {
      const now = new Date(nowValue).toISOString();
      const result = await sql.begin(async (tx): Promise<{ dispatch: RoutineDispatch; overlap: boolean }> => {
        const rows = await tx.unsafe<RoutineRow[]>(`
          SELECT ${routineColumns} FROM routines
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
        `, [routineId, userId]);
        const routine = rows[0];
        if (!routine) throw new Error("ROUTINE_NOT_FOUND");

        const active = await tx<{ id: string }[]>`
          SELECT id FROM tasks
          WHERE conversation_id = ${routine.conversation_id}
            AND status IN ('queued', 'running', 'waiting_approval', 'paused', 'uncertain')
          LIMIT 1
        `;
        const runId = id("routine_run");
        let status: RoutineRun["status"] = "skipped_overlap";
        let taskId: string | null = null;
        let taskJob: TaskJob | null = null;

        if (!active[0]) {
          const messageId = id("message");
          taskId = id("task");
          await tx`
            INSERT INTO messages (id, user_id, conversation_id, author_type, content, created_at)
            VALUES (${messageId}, ${routine.user_id}, ${routine.conversation_id}, 'user', ${routine.prompt}, ${now})
          `;
          await tx`
            INSERT INTO tasks (
              id, user_id, bot_id, conversation_id, message_id, status,
              last_event_sequence, created_at, updated_at
            ) VALUES (
              ${taskId}, ${routine.user_id}, ${routine.bot_id}, ${routine.conversation_id},
              ${messageId}, 'queued', 1, ${now}, ${now}
            )
          `;
          await tx`
            INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
            VALUES (${id("event")}, ${taskId}, ${routine.user_id}, 1, 'task.queued', ${JSON.stringify({ source: "routine", routineRunId: runId })}::jsonb, ${now})
          `;
          status = "queued";
          taskJob = {
            taskId,
            userId: routine.user_id,
            botId: routine.bot_id,
            conversationId: routine.conversation_id,
            messageId
          };
        }

        const runRows = await tx.unsafe<RoutineRunRow[]>(`
          INSERT INTO routine_runs (
            id, routine_id, user_id, scheduled_for, claimed_at, task_id, status,
            missed_count, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $4, $5, $6, 0, $4, $4)
          RETURNING ${runColumns}
        `, [runId, routine.id, routine.user_id, now, taskId, status]);
        await tx`
          UPDATE routines SET last_run_at = ${now}, last_run_status = ${status},
            version = version + 1, updated_at = ${now}
          WHERE id = ${routine.id}
        `;
        return {
          dispatch: { run: toRoutineRun(runRows[0]!), taskJob },
          overlap: Boolean(active[0])
        };
      });
      if (result.overlap) throw new RoutineActiveTaskError(result.dispatch.run);
      return result.dispatch;
    },

    async markRoutinePublicationFailed(runId: string, errorCode: string): Promise<RoutineRun> {
      return sql.begin(async (tx) => {
        const current = await tx<RoutineRunRow[]>`
          SELECT id, routine_id, user_id, scheduled_for, claimed_at, task_id, status,
            missed_count, error_code, created_at, updated_at
          FROM routine_runs WHERE id = ${runId} FOR UPDATE
        `;
        const run = current[0];
        if (!run) throw new Error("ROUTINE_RUN_NOT_FOUND");
        const now = new Date().toISOString();
        if (run.task_id) {
          const tasks = await tx<{ user_id: string; last_event_sequence: number }[]>`
            UPDATE tasks SET status = 'failed', last_event_sequence = last_event_sequence + 1, updated_at = ${now}
            WHERE id = ${run.task_id}
              AND status IN ('queued', 'running', 'waiting_approval', 'paused', 'uncertain')
            RETURNING user_id, last_event_sequence
          `;
          if (tasks[0]) {
            await tx`
              INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
              VALUES (
                ${id("event")}, ${run.task_id}, ${tasks[0].user_id}, ${tasks[0].last_event_sequence},
                'task.failed', ${JSON.stringify({ errorCode })}::jsonb, ${now}
              )
            `;
          }
        }
        const rows = await tx<RoutineRunRow[]>`
          UPDATE routine_runs
          SET status = 'publication_failed', error_code = ${errorCode}, updated_at = ${now}
          WHERE id = ${runId}
          RETURNING id, routine_id, user_id, scheduled_for, claimed_at, task_id, status,
            missed_count, error_code, created_at, updated_at
        `;
        await tx`
          UPDATE routines SET last_run_status = 'publication_failed', updated_at = ${now}
          WHERE id = ${run.routine_id}
        `;
        return toRoutineRun(rows[0]!);
      });
    },

    async listRoutineRuns(routineId: string, userId: string, limit = 20): Promise<RoutineRun[]> {
      const rows = await sql.unsafe<RoutineRunRow[]>(`
        SELECT rr.id, rr.routine_id, rr.user_id, rr.scheduled_for, rr.claimed_at,
               rr.task_id, rr.status, rr.missed_count, rr.error_code, rr.created_at, rr.updated_at
        FROM routine_runs rr
        INNER JOIN routines r ON r.id = rr.routine_id
        WHERE rr.routine_id = $1 AND r.user_id = $2
        ORDER BY rr.created_at DESC, rr.id DESC
        LIMIT $3
      `, [routineId, userId, limit]);
      return rows.map(toRoutineRun);
    },

    async listRoutineRunsPage(
      routineId: string,
      userId: string,
      input: { cursor?: string; limit: number }
    ): Promise<{ runs: RoutineRun[]; nextCursor: string | null }> {
      let cursorCreatedAt: string | null = null;
      let cursorId: string | null = null;
      if (input.cursor) {
        const cursorRows = await sql<{ id: string; created_at: DateValue }[]>`
          SELECT rr.id, rr.created_at
          FROM routine_runs rr
          INNER JOIN routines r ON r.id = rr.routine_id
          WHERE rr.id = ${input.cursor} AND rr.routine_id = ${routineId} AND r.user_id = ${userId}
        `;
        if (!cursorRows[0]) throw new Error("ROUTINE_RUN_CURSOR_INVALID");
        cursorCreatedAt = iso(cursorRows[0].created_at);
        cursorId = cursorRows[0].id;
      }

      const rows = await sql.unsafe<RoutineRunRow[]>(`
        SELECT rr.id, rr.routine_id, rr.user_id, rr.scheduled_for, rr.claimed_at,
               rr.task_id, rr.status, rr.missed_count, rr.error_code, rr.created_at, rr.updated_at
        FROM routine_runs rr
        INNER JOIN routines r ON r.id = rr.routine_id
        WHERE rr.routine_id = $1 AND r.user_id = $2
          AND ($3::timestamptz IS NULL OR (rr.created_at, rr.id) < ($3::timestamptz, $4::text))
        ORDER BY rr.created_at DESC, rr.id DESC
        LIMIT $5
      `, [routineId, userId, cursorCreatedAt, cursorId, input.limit + 1]);
      const hasMore = rows.length > input.limit;
      const runs = rows.slice(0, input.limit).map(toRoutineRun);
      return { runs, nextCursor: hasMore ? runs.at(-1)?.id ?? null : null };
    }
  };
}
