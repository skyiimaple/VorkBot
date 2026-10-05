import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const phase3SqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0002_phase3.sql");
const recoverySqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0003_task_recovery.sql");
const routinesSqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0004_routines.sql");
const botNameUniqueSqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0005_bot_name_unique.sql");
const agentSessionsSqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0006_agent_sessions.sql");
const sdkRunsSqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../database/migrations/0007_sdk_agent_runs.sql");

export function getTestDatabaseUrl(): string {
  const databaseUrl = process.env.VORK_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("VORK_TEST_DATABASE_URL or TEST_DATABASE_URL must point to a dedicated *_test PostgreSQL database");
  }

  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("VORK_TEST_DATABASE_URL must target a dedicated *_test PostgreSQL database");
  }

  return databaseUrl;
}

export async function resetFoundationDatabase(databaseUrl: string): Promise<void> {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error("Refusing to reset a database that is not named *_test");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.unsafe(readFileSync(phase3SqlPath, "utf8"));
    await sql.unsafe(readFileSync(recoverySqlPath, "utf8"));
    await sql.unsafe(readFileSync(routinesSqlPath, "utf8"));
    await sql.unsafe(readFileSync(agentSessionsSqlPath, "utf8"));
    await sql.unsafe(readFileSync(sdkRunsSqlPath, "utf8").replaceAll("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "));
    await sql.unsafe(
      "TRUNCATE TABLE agent_sessions, routine_runs, routines, tool_calls, task_checkpoints, approvals, memories, skill_proposals, model_credentials, task_events, tasks, messages, conversation_members, conversations, bots, users RESTART IDENTITY CASCADE"
    );
    await sql.unsafe(readFileSync(botNameUniqueSqlPath, "utf8"));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
