import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { FileService } from "./files/service.js";
import { registerFileRoutes } from "./files/routes.js";
import { LeaseManager } from "./slots/lease-manager.js";
import { BrowserService } from "./browser/service.js";
import { BrowserSessionRegistry } from "./browser/session.js";
import { registerBrowserRoutes } from "./browser/routes.js";
import { ControlStateStore } from "./control/state.js";
import { registerControlRoutes } from "./control/routes.js";
import { registerFrameRoutes } from "./frame/routes.js";
import { registerSlotRoutes } from "./slots/routes.js";
import { createMemoryPressureReader } from "./system/memory-pressure.js";
import { TerminalService } from "./terminal/service.js";
import { registerTerminalRoutes } from "./terminal/routes.js";

export type ComputerAppOptions = {
  token: string;
  maxSlots: number;
  maxBrowserSlots?: number;
  workspaceRoot?: string;
  browserProfilesRoot?: string;
  leaseTtlMs?: number;
  isMemoryPressure?: () => boolean;
};

export function buildComputerApp(options: ComputerAppOptions): FastifyInstance {
  const app = Fastify();
  const workspaceRoot = options.workspaceRoot ?? "/workspace";
  const browserProfilesRoot = options.browserProfilesRoot ?? "/browser-profiles";
  const controlStore = new ControlStateStore();
  const browserSessions = new BrowserSessionRegistry(browserProfilesRoot);

  let browserService: BrowserService | undefined;
  let terminalService: TerminalService | undefined;
  const leaseManager = new LeaseManager({
    maxSlots: options.maxSlots,
    maxBrowserSlots: options.maxBrowserSlots,
    ttlMs: options.leaseTtlMs,
    isMemoryPressure: options.isMemoryPressure,
    onExpired: ({ slotId, kind }) => {
      controlStore.reset(slotId);
      if (kind === "browser" || kind === "agent") {
        void browserService?.releaseSlot(slotId);
      }
      if (kind === "terminal" || kind === "agent") {
        void terminalService?.releaseSlot(slotId);
      }
    }
  });
  const fileService = new FileService({ workspaceRoot, leaseManager });
  browserService = new BrowserService({
    leaseManager,
    sessionRegistry: browserSessions,
    controlStore
  });
  terminalService = new TerminalService({ workspaceRoot, leaseManager });

  registerAuth(app, options.token);
  registerSlotRoutes(app, leaseManager, {
    onRelease: async ({ slotId, kind }) => {
      controlStore.reset(slotId);
      if (kind === "browser" || kind === "agent") {
        await browserService?.releaseSlot(slotId);
      }
      if (kind === "terminal" || kind === "agent") {
        await terminalService?.releaseSlot(slotId);
      }
    }
  });
  registerFileRoutes(app, fileService);
  registerBrowserRoutes(app, browserService);
  registerTerminalRoutes(app, terminalService);
  registerControlRoutes(app, controlStore);
  registerFrameRoutes(app, { leaseManager, sessions: browserSessions });

  app.get("/health", async () => ({ status: "ok" as const }));
  app.addHook("onClose", async () => terminalService?.dispose());

  return app;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const app = buildComputerApp({
    token: config.token,
    maxSlots: config.maxSlots,
    maxBrowserSlots: config.maxBrowserSlots,
    isMemoryPressure: createMemoryPressureReader()
  });
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void start();
}
