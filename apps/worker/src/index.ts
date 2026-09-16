import Redis from "ioredis";
import { createRepositories } from "@vork/database";
import { z } from "zod";
import { createComputerClientFromEnv } from "./computer-client.js";
import { FakeModel } from "./fake-model.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { createTaskWorker, RedisTaskNotifier } from "./queue.js";

const WorkerConfigSchema = z.object({
  databaseUrl: z.string().url().optional(),
  redisUrl: z.string().url().default("redis://127.0.0.1:6379"),
  computerUrl: z.string().url().optional(),
  computerToken: z.string().min(1).optional()
});

export async function start(): Promise<void> {
  const config = WorkerConfigSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    computerUrl: process.env.VORK_COMPUTER_URL,
    computerToken: process.env.VORK_COMPUTER_TOKEN
  });
  const repos = createRepositories({ databaseUrl: config.databaseUrl });
  const workerRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const publisherRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const computer =
    config.computerUrl && config.computerToken
      ? createComputerClientFromEnv({
          ...process.env,
          VORK_COMPUTER_URL: config.computerUrl,
          VORK_COMPUTER_TOKEN: config.computerToken
        })
      : undefined;
  const worker = createTaskWorker(
    {
      repos,
      model: new FakeModel(["你好，", "我是 Vork。"]),
      notifier: new RedisTaskNotifier(publisherRedis),
      computer
    },
    workerRedis
  );
  await worker.waitUntilReady();
  const stopHeartbeat = await startWorkerHeartbeat(publisherRedis);

  const shutdown = async () => {
    await stopHeartbeat();
    await worker.close();
    await Promise.all([workerRedis.quit(), publisherRedis.quit(), repos.close()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void start();
