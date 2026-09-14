import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DatabaseClientOptions = {
  databaseUrl?: string;
};

export function createDatabaseClient(options: DatabaseClientOptions = {}) {
  const sql = postgres(options.databaseUrl ?? process.env.DATABASE_URL ?? "postgres://vork:vork@localhost:5432/vork");

  return {
    sql,
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 })
  };
}
