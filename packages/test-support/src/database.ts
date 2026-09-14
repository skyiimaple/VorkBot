import postgres from "postgres";

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
    await sql.unsafe(
      "TRUNCATE TABLE task_events, tasks, messages, conversation_members, conversations, bots, users RESTART IDENTITY CASCADE"
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
