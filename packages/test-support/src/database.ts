import postgres from "postgres";

export async function resetFoundationDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql.unsafe(
      "TRUNCATE TABLE task_events, tasks, messages, conversation_members, conversations, bots, users RESTART IDENTITY CASCADE"
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
