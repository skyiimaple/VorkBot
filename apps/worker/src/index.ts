import Redis from "ioredis";
import { Queue } from "bullmq";
import type { TaskJob } from "@vork/contracts";
import { createRepositories } from "@vork/database";
import { z } from "zod";
import { createComputerClientFromEnv } from "./computer-client.js";
import { createModelFromEnv } from "./create-model.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { createTaskWorker, RedisTaskNotifier, TASK_JOB_NAME, TASK_QUEUE_NAME } from "./queue.js";
import { recoverTasksOnStartup } from "./task-recovery.js";
import { scanDueRoutines, startRoutineScheduler } from "./routine-scheduler.js";
import { OpenAIAgentsRuntime } from "./openai-agents-runtime.js";
import { createSdkRuntimeFromConfig } from "./create-sdk-runtime.js";

const optionalNonEmptyString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional()
);
const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional()
);

const WorkerConfigSchema = z.object({
  databaseUrl: z.string().url().optional(),
  redisUrl: z.string().url().default("redis://127.0.0.1:6379"),
  computerUrl: z.string().url().optional(),
  computerToken: z.string().min(1).optional(),
  routineScanIntervalMs: z.coerce.number().int().min(100).default(5_000),
  agentRuntime: z.enum(["agents-sdk", "openai-agents", "legacy"]).default("agents-sdk"),
  openAIApiKey: optionalNonEmptyString,
  openAIBaseUrl: optionalUrl,
  openAIAgentModel: z.string().min(1).default("gpt-6-astra")
});

export async function start(): Promise<void> {
  const config = WorkerConfigSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    computerUrl: process.env.VORK_COMPUTER_URL,
    computerToken: process.env.VORK_COMPUTER_TOKEN,
    routineScanIntervalMs: process.env.VORK_ROUTINE_SCAN_INTERVAL_MS,
    agentRuntime: process.env.VORK_AGENT_RUNTIME,
    openAIApiKey: process.env.OPENAI_API_KEY,
    openAIBaseUrl: process.env.OPENAI_BASE_URL,
    openAIAgentModel: process.env.OPENAI_AGENT_MODEL
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
  const storedCredential = await repos.getModelCredential("user_local").catch(() => null);
  if (!process.env.LLM_API_KEY?.trim() && storedCredential?.apiKey) {
    process.env.LLM_API_KEY = storedCredential.apiKey;
    if (storedCredential.baseUrl) process.env.LLM_BASE_URL = storedCredential.baseUrl;
    if (storedCredential.model) process.env.LLM_MODEL = storedCredential.model;
  }
  const model = createModelFromEnv();
  const agentsApiKey = config.openAIApiKey;
  const agentsBaseUrl = config.openAIBaseUrl;
  const agentsModel = config.openAIAgentModel;
  const agentRuntime = config.agentRuntime === "openai-agents" && agentsApiKey
    ? new OpenAIAgentsRuntime({
        apiKey: agentsApiKey,
        baseURL: agentsBaseUrl,
        model: agentsModel
      })
    : undefined;
  const recoveryQueue = new Queue<TaskJob>(TASK_QUEUE_NAME, { connection: workerRedis });
  await recoverTasksOnStartup(
    {
      publish: (job, options) => recoveryQueue.add(TASK_JOB_NAME, job, options)
    },
    repos
  );
  const routineSchedulerDependencies = {
    claimDueRoutineRuns: repos.claimDueRoutineRuns,
    markRoutinePublicationFailed: repos.markRoutinePublicationFailed,
    publish: (job: TaskJob, options?: { jobId?: string }) => recoveryQueue.add(TASK_JOB_NAME, job, options)
  };
  await scanDueRoutines(routineSchedulerDependencies, new Date());
  const worker = createTaskWorker(
    {
      repos,
      model,
      notifier: new RedisTaskNotifier(publisherRedis),
      computer,
      agentRuntimeMode: config.agentRuntime,
      agentRuntime,
      sdkRuntimeFactory: async (userId) => createSdkRuntimeFromConfig(process.env, await repos.getModelCredential(userId))
    },
    workerRedis
  );
  await worker.waitUntilReady();
  const stopRoutineScheduler = startRoutineScheduler(routineSchedulerDependencies, {
    immediate: false,
    intervalMs: config.routineScanIntervalMs,
    onError: (error) => console.error("Routine scheduler scan failed", error)
  });
  const stopHeartbeat = await startWorkerHeartbeat(publisherRedis);

  const shutdown = async () => {
    await stopRoutineScheduler();
    await stopHeartbeat();
    await worker.close();
    await Promise.all([recoveryQueue.close(), workerRedis.quit(), publisherRedis.quit(), repos.close()]);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void start();
