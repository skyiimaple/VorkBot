import type Redis from "ioredis";

export const WORKER_HEARTBEAT_KEY = "vork:worker:heartbeat";

export async function startWorkerHeartbeat(
  redis: Pick<Redis, "set" | "del">,
  intervalMs = 5_000
): Promise<() => Promise<void>> {
  const publish = () => redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 15);
  await publish();
  const timer = setInterval(() => { void publish().catch(() => {}); }, intervalMs);
  return async () => {
    clearInterval(timer);
    await redis.del(WORKER_HEARTBEAT_KEY);
  };
}
