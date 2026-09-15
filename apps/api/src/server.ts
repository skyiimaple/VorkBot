import { Queue } from "bullmq";
import { createRepositories } from "@vork/database";
import { z } from "zod";
import { buildApp } from "./app.js";

const ServerConfigSchema = z.object({
  databaseUrl: z.string().url().optional(),
  redisHost: z.string().min(1).default("127.0.0.1"),
  redisPort: z.coerce.number().int().positive().default(6379),
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().min(1).default("127.0.0.1")
});

export async function start(): Promise<void> {
  const config = ServerConfigSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisHost: process.env.REDIS_HOST,
    redisPort: process.env.REDIS_PORT,
    port: process.env.PORT,
    host: process.env.HOST
  });
  const repositories = createRepositories({ databaseUrl: config.databaseUrl });
  const queue = new Queue("tasks", { connection: { host: config.redisHost, port: config.redisPort } });
  const app = buildApp({
    repositories,
    queue: {
      publish: (job) => queue.add("execute-task", job, { jobId: job.taskId })
    }
  });
  app.addHook("onClose", async () => {
    await queue.close();
    await repositories.close();
  });
  await app.listen({ host: config.host, port: config.port });
}

void start();
