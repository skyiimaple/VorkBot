import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { FileService } from "./files/service.js";
import { registerFileRoutes } from "./files/routes.js";
import { LeaseManager } from "./slots/lease-manager.js";
import { registerSlotRoutes } from "./slots/routes.js";

export type ComputerAppOptions = {
  token: string;
  maxSlots: number;
  workspaceRoot?: string;
  leaseTtlMs?: number;
};

export function buildComputerApp(options: ComputerAppOptions): FastifyInstance {
  const app = Fastify();
  const workspaceRoot = options.workspaceRoot ?? "/workspace";
  const leaseManager = new LeaseManager({
    maxSlots: options.maxSlots,
    ttlMs: options.leaseTtlMs
  });
  const fileService = new FileService({ workspaceRoot, leaseManager });

  registerAuth(app, options.token);
  registerSlotRoutes(app, leaseManager);
  registerFileRoutes(app, fileService);

  app.get("/health", async () => ({ status: "ok" as const }));

  return app;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const app = buildComputerApp({ token: config.token, maxSlots: config.maxSlots });
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void start();
}
