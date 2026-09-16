import { Queue } from "bullmq";
import { createRepositories } from "@vork/database";
import { z } from "zod";
import { buildApp } from "./app.js";
import { RedisTaskEventSubscriber } from "./services/event-stream.js";

const ServerConfigSchema = z.object({
  databaseUrl: z.string().url().optional(),
  redisHost: z.string().min(1).default("127.0.0.1"),
  redisPort: z.coerce.number().int().positive().default(6379),
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().min(1).default("127.0.0.1"),
  computerUrl: z.string().url().optional(),
  computerToken: z.string().min(1).optional()
});

export async function start(): Promise<void> {
  const config = ServerConfigSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisHost: process.env.REDIS_HOST,
    redisPort: process.env.REDIS_PORT,
    port: process.env.PORT,
    host: process.env.HOST,
    computerUrl: process.env.VORK_COMPUTER_URL,
    computerToken: process.env.VORK_COMPUTER_TOKEN
  });
  const repositories = createRepositories({ databaseUrl: config.databaseUrl });
  const queue = new Queue("tasks", { connection: { host: config.redisHost, port: config.redisPort } });
  const app = buildApp({
    repositories,
    queue: {
      publish: (job) => queue.add("execute-task", job, { jobId: job.taskId })
    },
    eventSubscriber: new RedisTaskEventSubscriber(`redis://${config.redisHost}:${config.redisPort}`),
    computer:
      config.computerUrl && config.computerToken
        ? { baseUrl: config.computerUrl, token: config.computerToken }
        : undefined
  });
  app.addHook("onClose", async () => {
    await queue.close();
    await repositories.close();
  });
  await app.listen({ host: config.host, port: config.port });
}

void start();
