import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);

async function composeExec(service, ...args) {
  const { stdout } = await run("docker", ["compose", "exec", "-T", service, ...args], { timeout: 10_000 });
  return stdout.trim();
}

async function main() {
  const postgres = await composeExec("postgres", "pg_isready", "-U", "vork", "-d", "vork");
  if (!postgres.includes("accepting connections")) throw new Error("PostgreSQL is not ready");

  const redis = await composeExec("redis", "valkey-cli", "ping");
  if (redis !== "PONG") throw new Error("Valkey is not ready");

  const heartbeat = Number(await composeExec("redis", "valkey-cli", "GET", "vork:worker:heartbeat"));
  if (!Number.isFinite(heartbeat) || heartbeat <= 0 || Date.now() - heartbeat > 15_000) {
    throw new Error("Worker heartbeat is missing or stale");
  }

  await composeExec(
    "computer",
    "node",
    "-e",
    "fetch('http://127.0.0.1:8080/health').then(async (response) => { if (!response.ok) process.exit(1); const body = await response.json(); if (body.status !== 'ok') process.exit(1); }).catch(() => process.exit(1))"
  );

  const response = await fetch("http://127.0.0.1:3000/v1/bots", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !Array.isArray((await response.json()).bots)) throw new Error("API is not ready");
  process.stdout.write("API, PostgreSQL, Valkey, Worker and Computer are ready.\n");
}

main().catch((error) => {
  process.stderr.write(`Vork healthcheck failed: ${error.message}\n`);
  process.exitCode = 1;
});
