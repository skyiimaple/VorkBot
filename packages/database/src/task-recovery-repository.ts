import { nanoid } from "nanoid";
import {
  AgentActionSchema,
  CheckpointStateSchema,
  TaskControlStateSchema,
  ToolCallSchema
} from "@vork/contracts";
import type {
  AgentAction,
  CheckpointState,
  Task,
  TaskControlState,
  ToolCall,
  ToolCallRisk
} from "@vork/contracts";
import type { createDatabaseClient } from "./client.js";

type Sql = ReturnType<typeof createDatabaseClient>["sql"];
type DateValue = Date | string;

type TaskRow = {
  id: string;
  user_id: string;
  bot_id: string;
  conversation_id: string;
  message_id: string;
  status: Task["status"];
  pause_requested_at: DateValue | null;
  retry_count: number;
  next_retry_at: DateValue | null;
  last_event_sequence: number;
  created_at: DateValue;
  updated_at: DateValue;
};

type CheckpointRow = {
  id: string;
  task_id: string;
  user_id: string;
  version: number;
  state_json: unknown;
  created_at: DateValue;
};

type ToolCallRow = {
  id: string;
  task_id: string;
  user_id: string;
  turn: number;
  attempt: number;
  action_json: unknown;
  risk: ToolCallRisk;
  status: ToolCall["status"];
  observation: string | null;
  error_code: string | null;
  created_at: DateValue;
  updated_at: DateValue;
};

const taskColumns = `id, user_id, bot_id, conversation_id, message_id, status,
  pause_requested_at, retry_count, next_retry_at, last_event_sequence, created_at, updated_at`;

function makeId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

function iso(value: DateValue): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    status: row.status,
    pauseRequestedAt: row.pause_requested_at ? iso(row.pause_requested_at) : null,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at ? iso(row.next_retry_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toCheckpoint(row: CheckpointRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    version: row.version,
    state: CheckpointStateSchema.parse(row.state_json),
    createdAt: iso(row.created_at)
  };
}

function toToolCall(row: ToolCallRow): ToolCall {
  return ToolCallSchema.parse({
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    turn: row.turn,
    attempt: row.attempt,
    action: row.action_json,
    risk: row.risk,
    status: row.status,
    observation: row.observation,
    errorCode: row.error_code,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  });
}

export function createTaskRecoveryRepository(sql: Sql) {
  async function insertCheckpoint(transaction: Sql, input: { taskId: string; userId: string; state: CheckpointState }) {
    const state = CheckpointStateSchema.parse(input.state);
    const now = new Date().toISOString();
    const rows = await transaction<CheckpointRow[]>`
      INSERT INTO task_checkpoints (id, task_id, user_id, version, state_json, created_at)
      SELECT ${makeId("checkpoint")}, tasks.id, tasks.user_id,
        COALESCE((SELECT max(version) + 1 FROM task_checkpoints WHERE task_id = tasks.id), 1),
        ${JSON.stringify(state)}::jsonb, ${now}
      FROM tasks
      WHERE tasks.id = ${input.taskId} AND tasks.user_id = ${input.userId}
      RETURNING id, task_id, user_id, version, state_json, created_at
    `;
    const row = rows[0];
    if (!row) throw new Error("Task does not exist");
    return toCheckpoint(row);
  }

  return {
    async requestTaskPause(taskId: string, userId: string): Promise<Task> {
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe<TaskRow[]>(
          `SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [taskId, userId]
        );
        const task = rows[0];
        if (!task) throw new Error("Task does not exist");
        if (task.status !== "queued" && task.status !== "running") throw new Error("Task cannot be paused");
        const now = new Date().toISOString();
        const nextStatus = task.status === "queued" ? "paused" : "running";
        const pauseRequestedAt = task.status === "queued" ? null : now;
        const sequence = task.last_event_sequence + 1;
        const eventType = task.status === "queued" ? "task.paused" : "task.pause_requested";
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET status = $1, pause_requested_at = $2, last_event_sequence = $3, updated_at = $4
           WHERE id = $5 RETURNING ${taskColumns}`,
          [nextStatus, pauseRequestedAt, sequence, now, task.id]
        );
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence}, ${eventType}, ${JSON.stringify({})}::jsonb, ${now})
        `;
        return toTask(updated[0]!);
      });
    },

    async landTaskPause(input: { taskId: string; userId: string; state: CheckpointState }): Promise<Task> {
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe<TaskRow[]>(
          `SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [input.taskId, input.userId]
        );
        const task = rows[0];
        if (!task || task.status !== "running" || !task.pause_requested_at) throw new Error("Task cannot land pause");
        const checkpoint = await insertCheckpoint(transaction as unknown as Sql, input);
        const now = new Date().toISOString();
        const sequence = task.last_event_sequence + 2;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence - 1}, 'checkpoint.saved', ${JSON.stringify({ checkpointId: checkpoint.id, version: checkpoint.version })}::jsonb, ${now})
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.paused', ${JSON.stringify({})}::jsonb, ${now})
        `;
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET status = 'paused', pause_requested_at = NULL, last_event_sequence = $1, updated_at = $2
           WHERE id = $3 RETURNING ${taskColumns}`,
          [sequence, now, task.id]
        );
        return toTask(updated[0]!);
      });
    },

    async resumeTask(taskId: string, userId: string): Promise<Task> {
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe<TaskRow[]>(
          `SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`, [taskId, userId]
        );
        const task = rows[0];
        if (!task) throw new Error("Task does not exist");
        if (task.status !== "paused") throw new Error("Task cannot be resumed");
        const now = new Date().toISOString();
        const sequence = task.last_event_sequence + 1;
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET status = 'queued', pause_requested_at = NULL, last_event_sequence = $1, updated_at = $2
           WHERE id = $3 RETURNING ${taskColumns}`, [sequence, now, task.id]
        );
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.resumed', ${JSON.stringify({})}::jsonb, ${now})
        `;
        return toTask(updated[0]!);
      });
    },

    async saveTaskCheckpoint(input: { taskId: string; userId: string; state: CheckpointState }) {
      return sql.begin((transaction) => insertCheckpoint(transaction as unknown as Sql, input));
    },

    async getLatestTaskCheckpoint(taskId: string, userId: string) {
      const rows = await sql<CheckpointRow[]>`
        SELECT id, task_id, user_id, version, state_json, created_at
        FROM task_checkpoints WHERE task_id = ${taskId} AND user_id = ${userId}
        ORDER BY version DESC LIMIT 1
      `;
      return rows[0] ? toCheckpoint(rows[0]) : null;
    },

    async prepareToolCall(input: {
      taskId: string;
      userId: string;
      turn: number;
      attempt?: number;
      action: AgentAction;
      risk: ToolCallRisk;
    }): Promise<ToolCall> {
      const action = AgentActionSchema.parse(input.action);
      const now = new Date().toISOString();
      const attempt = input.attempt;
      const rows = await sql<ToolCallRow[]>`
        INSERT INTO tool_calls (id, task_id, user_id, turn, attempt, action_json, risk, status, created_at, updated_at)
        SELECT ${makeId("tool")}, tasks.id, tasks.user_id, ${input.turn},
          COALESCE(${attempt ?? null}, (
            SELECT max(existing.attempt) + 1
            FROM tool_calls existing
            WHERE existing.task_id = tasks.id AND existing.turn = ${input.turn}
          ), 0),
          ${JSON.stringify(action)}::jsonb, ${input.risk}, 'prepared', ${now}, ${now}
        FROM tasks WHERE tasks.id = ${input.taskId} AND tasks.user_id = ${input.userId}
        RETURNING id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
      `;
      if (!rows[0]) throw new Error("Task does not exist");
      return toToolCall(rows[0]);
    },

    async markToolCallExecuting(toolCallId: string, userId: string): Promise<ToolCall> {
      const now = new Date().toISOString();
      const rows = await sql<ToolCallRow[]>`
        UPDATE tool_calls SET status = 'executing', updated_at = ${now}
        WHERE id = ${toolCallId} AND user_id = ${userId} AND status = 'prepared'
        RETURNING id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
      `;
      if (!rows[0]) throw new Error("Tool call does not exist or is not prepared");
      return toToolCall(rows[0]);
    },

    async finishToolCallAndCheckpoint(input: {
      toolCallId: string;
      userId: string;
      observation: string;
      checkpoint: CheckpointState;
    }): Promise<{ toolCall: ToolCall; checkpoint: Awaited<ReturnType<typeof insertCheckpoint>> }> {
      return sql.begin(async (transaction) => {
        const callRows = await transaction<ToolCallRow[]>`
          SELECT id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
          FROM tool_calls WHERE id = ${input.toolCallId} AND user_id = ${input.userId} FOR UPDATE
        `;
        const call = callRows[0];
        if (!call || call.status !== "executing") throw new Error("Tool call is not executing");
        const observation = input.observation.slice(0, 4000);
        const checkpoint = await insertCheckpoint(transaction as unknown as Sql, { taskId: call.task_id, userId: input.userId, state: input.checkpoint });
        const taskRows = await transaction<TaskRow[]>`SELECT id, user_id, last_event_sequence FROM tasks WHERE id = ${call.task_id} FOR UPDATE`;
        const task = taskRows[0];
        if (!task) throw new Error("Task does not exist");
        const now = new Date().toISOString();
        const checkpointSequence = task.last_event_sequence + 1;
        const toolSequence = checkpointSequence + 1;
        const updatedCalls = await transaction<ToolCallRow[]>`
          UPDATE tool_calls SET status = 'succeeded', observation = ${observation}, error_code = NULL, updated_at = ${now}
          WHERE id = ${call.id}
          RETURNING id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at) VALUES
          (${makeId("event")}, ${task.id}, ${task.user_id}, ${checkpointSequence}, 'checkpoint.saved', ${JSON.stringify({ checkpointId: checkpoint.id, version: checkpoint.version })}::jsonb, ${now}),
          (${makeId("event")}, ${task.id}, ${task.user_id}, ${toolSequence}, 'tool.finished', ${JSON.stringify({ toolCallId: call.id, actionType: actionType(call.action_json) })}::jsonb, ${now})
        `;
        await transaction`UPDATE tasks SET last_event_sequence = ${toolSequence}, updated_at = ${now} WHERE id = ${task.id}`;
        return { toolCall: toToolCall(updatedCalls[0]!), checkpoint };
      });
    },

    async markToolCallUncertain(toolCallId: string, userId: string, errorCode = "UNCERTAIN_SIDE_EFFECT"): Promise<Task> {
      return sql.begin(async (transaction) => {
        const calls = await transaction<ToolCallRow[]>`
          UPDATE tool_calls SET status = 'uncertain', error_code = ${errorCode}, updated_at = now()
          WHERE id = ${toolCallId} AND user_id = ${userId} AND status = 'executing'
          RETURNING id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
        `;
        const call = calls[0];
        if (!call) throw new Error("Tool call is not executing");
        const tasks = await transaction.unsafe<TaskRow[]>(`SELECT ${taskColumns} FROM tasks WHERE id = $1 FOR UPDATE`, [call.task_id]);
        const task = tasks[0]!;
        const now = new Date().toISOString();
        const sequence = task.last_event_sequence + 1;
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET status = 'uncertain', last_event_sequence = $1, updated_at = $2 WHERE id = $3 RETURNING ${taskColumns}`,
          [sequence, now, task.id]
        );
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'tool.uncertain', ${JSON.stringify({ toolCallId: call.id, actionType: actionType(call.action_json), errorCode })}::jsonb, ${now})
        `;
        return toTask(updated[0]!);
      });
    },

    async getIncompleteToolCall(taskId: string, userId: string): Promise<ToolCall | null> {
      const rows = await sql<ToolCallRow[]>`
        SELECT id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
        FROM tool_calls WHERE task_id = ${taskId} AND user_id = ${userId} AND status IN ('prepared', 'executing', 'uncertain')
        ORDER BY turn DESC, attempt DESC LIMIT 1
      `;
      return rows[0] ? toToolCall(rows[0]) : null;
    },

    async listRecoverableTasks(): Promise<Array<{ task: Task; incompleteToolCall: ToolCall | null }>> {
      const rows = await sql<(TaskRow & { tool_call_id: string | null })[]>`
        SELECT tasks.*, latest.id AS tool_call_id
        FROM tasks
        LEFT JOIN LATERAL (
          SELECT id FROM tool_calls
          WHERE task_id = tasks.id AND status IN ('prepared', 'executing', 'uncertain')
          ORDER BY turn DESC, attempt DESC LIMIT 1
        ) latest ON true
        WHERE tasks.status IN ('queued', 'running')
        ORDER BY tasks.created_at ASC
      `;
      return Promise.all(rows.map(async (row) => ({
        task: toTask(row),
        incompleteToolCall: row.tool_call_id ? await this.getIncompleteToolCall(row.id, row.user_id) : null
      })));
    },

    async resolveUncertainToolCall(
      taskId: string,
      userId: string,
      resolution: "confirmed_success" | "retry" | "cancel"
    ): Promise<Task> {
      return sql.begin(async (transaction) => {
        const tasks = await transaction.unsafe<TaskRow[]>(
          `SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [taskId, userId]
        );
        const task = tasks[0];
        if (!task) throw new Error("Task does not exist");
        if (task.status !== "uncertain") throw new Error("Task is not uncertain");
        const calls = await transaction<ToolCallRow[]>`
          SELECT id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
          FROM tool_calls WHERE task_id = ${taskId} AND user_id = ${userId} AND status = 'uncertain'
          ORDER BY updated_at DESC LIMIT 1 FOR UPDATE
        `;
        const call = calls[0];
        if (!call) throw new Error("Uncertain tool call does not exist");
        const now = new Date().toISOString();
        const callStatus = resolution === "confirmed_success" ? "succeeded" : "failed";
        await transaction`
          UPDATE tool_calls
          SET status = ${callStatus},
              observation = ${resolution === "confirmed_success" ? "用户确认动作已完成" : call.observation},
              error_code = ${resolution === "confirmed_success" ? null : "USER_CONFIRMED_RETRY"},
              updated_at = ${now}
          WHERE id = ${call.id}
        `;
        const priorCheckpoints = await transaction<CheckpointRow[]>`
          SELECT id, task_id, user_id, version, state_json, created_at FROM task_checkpoints
          WHERE task_id = ${task.id} AND user_id = ${userId} ORDER BY version DESC LIMIT 1
        `;
        const prior = priorCheckpoints[0] ? toCheckpoint(priorCheckpoints[0]).state : {
          nextTurn: call.turn,
          lastObservation: "",
          reply: "",
          modelTurns: call.turn,
          toolCalls: call.turn,
          lastCompletedToolCallId: null
        };
        const checkpoint = await insertCheckpoint(transaction as unknown as Sql, {
          taskId: task.id,
          userId,
          state: {
            ...prior,
            nextTurn: resolution === "confirmed_success" ? call.turn + 1 : call.turn,
            lastObservation: resolution === "confirmed_success" ? "用户确认动作已完成" : prior.lastObservation,
            lastCompletedToolCallId: resolution === "confirmed_success" ? call.id : prior.lastCompletedToolCallId
          }
        });
        const checkpointSequence = task.last_event_sequence + 1;
        const resolvedSequence = checkpointSequence + 1;
        const finalSequence = resolvedSequence + 1;
        const nextStatus = resolution === "cancel" ? "cancelled" : "queued";
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (${makeId("event")}, ${task.id}, ${task.user_id}, ${checkpointSequence}, 'checkpoint.saved', ${JSON.stringify({ checkpointId: checkpoint.id, version: checkpoint.version })}::jsonb, ${now})
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${makeId("event")}, ${task.id}, ${task.user_id}, ${resolvedSequence}, 'tool.uncertain_resolved',
            ${JSON.stringify({ toolCallId: call.id, actionType: actionType(call.action_json), resolution })}::jsonb, ${now}
          )
        `;
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${makeId("event")}, ${task.id}, ${task.user_id}, ${finalSequence},
            ${resolution === "cancel" ? "task.cancelled" : "task.queued"}, ${JSON.stringify({ reason: "uncertain_resolution" })}::jsonb, ${now}
          )
        `;
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET status = $1, pause_requested_at = NULL, last_event_sequence = $2, updated_at = $3
           WHERE id = $4 RETURNING ${taskColumns}`,
          [nextStatus, finalSequence, now, task.id]
        );
        return toTask(updated[0]!);
      });
    },

    async scheduleTaskRetry(input: {
      taskId: string;
      userId: string;
      attempt: number;
      nextRetryAt: string;
      errorCode: string;
    }): Promise<Task> {
      return sql.begin(async (transaction) => {
        const tasks = await transaction.unsafe<TaskRow[]>(
          `SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [input.taskId, input.userId]
        );
        const task = tasks[0];
        if (!task) throw new Error("Task does not exist");
        const now = new Date().toISOString();
        const sequence = task.last_event_sequence + 1;
        const updated = await transaction.unsafe<TaskRow[]>(
          `UPDATE tasks SET retry_count = retry_count + 1, next_retry_at = $1, last_event_sequence = $2, updated_at = $3
           WHERE id = $4 RETURNING ${taskColumns}`,
          [input.nextRetryAt, sequence, now, task.id]
        );
        await transaction`
          INSERT INTO task_events (id, task_id, user_id, sequence, type, payload, created_at)
          VALUES (
            ${makeId("event")}, ${task.id}, ${task.user_id}, ${sequence}, 'task.retry_scheduled',
            ${JSON.stringify({ errorCode: input.errorCode, attempt: input.attempt, nextRetryAt: input.nextRetryAt })}::jsonb, ${now}
          )
        `;
        return toTask(updated[0]!);
      });
    },

    async clearTaskRetry(taskId: string, userId: string): Promise<void> {
      await sql`UPDATE tasks SET next_retry_at = NULL, updated_at = now() WHERE id = ${taskId} AND user_id = ${userId}`;
    },

    async getTaskControlState(taskId: string, userId: string): Promise<TaskControlState | null> {
      const rows = await sql.unsafe<TaskRow[]>(`SELECT ${taskColumns} FROM tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
      const task = rows[0];
      if (!task) return null;
      const approval = await sql<{ id: string; reason: string; action: unknown }[]>`
        SELECT id, reason, action FROM approvals WHERE task_id = ${taskId} AND user_id = ${userId} AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
      `;
      const uncertain = await sql<ToolCallRow[]>`
        SELECT id, task_id, user_id, turn, attempt, action_json, risk, status, observation, error_code, created_at, updated_at
        FROM tool_calls WHERE task_id = ${taskId} AND user_id = ${userId} AND status = 'uncertain'
        ORDER BY updated_at DESC LIMIT 1
      `;
      const pending = approval[0];
      const uncertainCall = uncertain[0];
      return TaskControlStateSchema.parse({
        task: toTask(task),
        ...(pending ? { pendingApproval: summary(pending.id, pending.action, pending.reason) } : {}),
        ...(uncertainCall ? { uncertainToolCall: summary(uncertainCall.id, uncertainCall.action_json, "动作结果无法确认") } : {})
      });
    }
  };
}

function actionType(action: unknown): string {
  return action && typeof action === "object" && "type" in action && typeof action.type === "string" ? action.type : "unknown";
}

function actionTarget(action: unknown): string {
  if (!action || typeof action !== "object") return "未提供目标";
  const record = action as Record<string, unknown>;
  for (const key of ["path", "from", "url", "ref", "sessionId"] as const) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return "当前任务";
}

function summary(id: string, action: unknown, riskReason: string) {
  return { id, actionType: actionType(action), riskReason, target: actionTarget(action) };
}
