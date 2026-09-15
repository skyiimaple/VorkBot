import Redis from "ioredis";
import { createRepositories } from "@vork/database";
import { z } from "zod";
import { FakeModel } from "./fake-model.js";
import { createTaskWorker, RedisTaskNotifier } from "./queue.js";

const WorkerConfigSchema = z.object({
  databaseUrl: z.string().url().optional(),
  redisUrl: z.string().url().default("redis://127.0.0.1:6379")
});

export async function start(): Promise<void> {
  const config = WorkerConfigSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL
  });
  const repos = createRepositories({ databaseUrl: config.databaseUrl });
  const workerRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const publisherRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = createTaskWorker(
    { repos, model: new FakeModel(["你好，", "我是 Vork。"]), notifier: new RedisTaskNotifier(publisherRedis) },
    workerRedis
  );

  const shutdown = async () => {
    await worker.close();
    await Promise.all([workerRedis.quit(), publisherRedis.quit(), repos.close()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void start();
