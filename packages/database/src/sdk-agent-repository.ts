import { nanoid } from "nanoid";
import { AgentActionSchema, ToolCallSchema, type AgentToolAction, type ToolCall, type ToolCallRisk } from "@vork/contracts";
import type { createDatabaseClient } from "./client.js";

type Sql = ReturnType<typeof createDatabaseClient>["sql"];
type ToolRow = {
  id: string; task_id: string; user_id: string; turn: number; attempt: number;
  action_json: unknown; risk: ToolCallRisk; status: ToolCall["status"];
  observation: string | null; error_code: string | null; created_at: Date | string; updated_at: Date | string;
};
const toToolCall = (row: ToolRow): ToolCall => ToolCallSchema.parse({
  id: row.id, taskId: row.task_id, userId: row.user_id, turn: row.turn, attempt: row.attempt,
  action: row.action_json, risk: row.risk, status: row.status, observation: row.observation, errorCode: row.error_code,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
});

export function createSdkAgentRepository(sql: Sql) {
  return {
    async getApprovedSdkAction(taskId: string, userId: string): Promise<{ id: string; callId: string } | null> {
      const rows = await sql<{ id: string; call_id: string }[]>`
        SELECT id, action->>'sdkCallId' AS call_id FROM approvals
        WHERE task_id = ${taskId} AND user_id = ${userId} AND status = 'approved' AND executed_at IS NULL
          AND action->>'sdkCallId' IS NOT NULL
        ORDER BY resolved_at DESC LIMIT 1
      `;
      return rows[0] ? { id: rows[0].id, callId: rows[0].call_id } : null;
    },

    async markSdkApprovalApplied(approvalId: string, userId: string): Promise<void> {
      await sql`UPDATE approvals SET executed_at = now() WHERE id = ${approvalId} AND user_id = ${userId} AND status = 'approved'`;
    },

    async getSdkAgentRun(taskId: string, userId: string): Promise<{ state: string; history: unknown[] | null } | null> {
      const rows = await sql<{ state_text: string; history_json: unknown[] | null }[]>`
        SELECT state_text, history_json FROM sdk_agent_runs WHERE task_id = ${taskId} AND user_id = ${userId}
      `;
      return rows[0] ? { state: rows[0].state_text, history: rows[0].history_json } : null;
    },

    async saveSdkAgentRun(input: { taskId: string; userId: string; state: string; history?: unknown[] }): Promise<void> {
      JSON.parse(input.state);
      const rows = await sql`
        INSERT INTO sdk_agent_runs (task_id, user_id, state_text, history_json)
        SELECT id, user_id, ${input.state}, ${input.history === undefined ? null : JSON.stringify(input.history)}::jsonb
        FROM tasks WHERE id = ${input.taskId} AND user_id = ${input.userId}
        ON CONFLICT (task_id) DO UPDATE SET state_text = EXCLUDED.state_text,
          history_json = COALESCE(EXCLUDED.history_json, sdk_agent_runs.history_json), updated_at = now()
        RETURNING task_id
      `;
      if (!rows[0]) throw new Error("Task does not exist");
    },

    async getSdkConversationHistory(input: { taskId: string; userId: string; conversationId: string }): Promise<{ messageId: string; history: unknown[] } | null> {
      const rows = await sql<{ message_id: string; history_json: unknown[] }[]>`
        SELECT prior.message_id, runs.history_json
        FROM sdk_agent_runs runs JOIN tasks prior ON prior.id = runs.task_id
        JOIN tasks current_task ON current_task.id = ${input.taskId} AND current_task.user_id = ${input.userId}
        WHERE prior.user_id = ${input.userId} AND prior.conversation_id = ${input.conversationId}
          AND prior.status = 'completed' AND runs.history_json IS NOT NULL AND prior.created_at < current_task.created_at
        ORDER BY prior.created_at DESC LIMIT 1
      `;
      return rows[0] ? { messageId: rows[0].message_id, history: rows[0].history_json } : null;
    },

    async prepareSdkToolCall(input: { taskId: string; userId: string; callId: string; action: AgentToolAction; risk: ToolCallRisk }): Promise<ToolCall> {
      const action = AgentActionSchema.parse(input.action);
      return sql.begin(async (transaction) => {
        const tasks = await transaction`SELECT id FROM tasks WHERE id = ${input.taskId} AND user_id = ${input.userId} FOR UPDATE`;
        if (!tasks[0]) throw new Error("Task does not exist");
        const previous = await transaction<ToolRow[]>`
          SELECT calls.* FROM tool_calls calls JOIN sdk_tool_links links ON links.tool_call_id = calls.id
          WHERE links.task_id = ${input.taskId} AND links.call_id = ${input.callId}
        `;
        const existing = previous[0] ? toToolCall(previous[0]) : undefined;
        if (existing && JSON.stringify(existing.action) !== JSON.stringify(action)) throw new Error("SDK_TOOL_CALL_MISMATCH");
        if (existing && existing.status !== "failed") return existing;
        const rows = await transaction<ToolRow[]>`
          INSERT INTO tool_calls (id, task_id, user_id, turn, attempt, action_json, risk, status, created_at, updated_at)
          VALUES (${`tool_${nanoid()}`}, ${input.taskId}, ${input.userId},
            COALESCE(${existing?.turn ?? null}, (SELECT COALESCE(max(turn), 0) + 1 FROM tool_calls WHERE task_id = ${input.taskId})),
            ${existing ? existing.attempt + 1 : 0}, ${JSON.stringify(action)}::jsonb, ${input.risk}, 'prepared', now(), now())
          RETURNING *
        `;
        const call = toToolCall(rows[0]!);
        await transaction`
          INSERT INTO sdk_tool_links (task_id, call_id, tool_call_id) VALUES (${input.taskId}, ${input.callId}, ${call.id})
          ON CONFLICT (task_id, call_id) DO UPDATE SET tool_call_id = EXCLUDED.tool_call_id
        `;
        return call;
      });
    }
  };
}
