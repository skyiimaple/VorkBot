import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeaseManager } from "../slots/lease-manager.js";
import { TerminalService } from "./service.js";

describe("TerminalService", () => {
  let workspaceRoot: string;
  let leaseManager: LeaseManager;
  let service: TerminalService;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "vork-terminal-"));
    leaseManager = new LeaseManager({ maxSlots: 3 });
    service = new TerminalService({ workspaceRoot, leaseManager, maxOutputBytes: 1024 });
  });

  afterEach(async () => {
    await service.dispose();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("runs commands inside the leased Bot workspace and reads output incrementally", async () => {
    const lease = leaseManager.acquire({ taskId: "task_1", botId: "bot_1", kind: "terminal" });
    if ("code" in lease) throw new Error(lease.code);

    const started = await service.start({ leaseId: lease.leaseId, command: "pwd; printf hello" });
    const first = await waitForOutput(service, lease.leaseId, started.sessionId, 0, "hello");

    expect(first.output).toContain(join(workspaceRoot, "bots", "bot_1"));
    expect(first.output).toContain("hello");
    const second = await service.read({ leaseId: lease.leaseId, sessionId: started.sessionId, cursor: first.nextCursor });
    expect(second.output).toBe("");
  });

  it.skipIf(process.platform !== "linux")("runs commands with a real pseudo-terminal", async () => {
    const lease = leaseManager.acquire({ taskId: "task_tty", botId: "bot_tty", kind: "terminal" });
    if ("code" in lease) throw new Error(lease.code);

    const started = await service.start({
      leaseId: lease.leaseId,
      command: "test -t 1 && printf tty-ok || printf no-tty"
    });
    const result = await waitForOutput(service, lease.leaseId, started.sessionId, 0, "tty");

    expect(result.output).toContain("tty-ok");
    expect(result.output).not.toContain("no-tty");
  });

  it("terminates all terminal sessions when a slot is released", async () => {
    const lease = leaseManager.acquire({ taskId: "task_2", botId: "bot_2", kind: "terminal" });
    if ("code" in lease) throw new Error(lease.code);

    const started = await service.start({ leaseId: lease.leaseId, command: "sleep 30" });
    await service.releaseSlot(lease.slotId);
    const result = await service.read({ leaseId: lease.leaseId, sessionId: started.sessionId, cursor: 0 });

    expect(result.status).toBe("terminated");
  });

  it("truncates retained output and reports stale cursors", async () => {
    const lease = leaseManager.acquire({ taskId: "task_3", botId: "bot_3", kind: "terminal" });
    if ("code" in lease) throw new Error(lease.code);

    const started = await service.start({
      leaseId: lease.leaseId,
      command: "node -e \"process.stdout.write('x'.repeat(2048))\""
    });
    const result = await waitForOutput(service, lease.leaseId, started.sessionId, 0, "xxxxxxxxxx");

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1024);
  });
});

async function waitForOutput(
  service: TerminalService,
  leaseId: string,
  sessionId: string,
  cursor: number,
  expected: string
) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await service.read({ leaseId, sessionId, cursor });
    if (result.output.includes(expected)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for terminal output: ${expected}`);
}
