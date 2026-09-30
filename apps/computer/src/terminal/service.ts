import { mkdir } from "node:fs/promises";
import type {
  TerminalReadInput,
  TerminalReadResult,
  TerminalStartInput,
  TerminalStartResult,
  TerminalTerminateInput,
  TerminalWriteInput
} from "@vork/contracts";
import type { LeaseManager } from "../slots/lease-manager.js";
import { resolveBotPath } from "../files/path-sandbox.js";
import { TerminalSession } from "./session.js";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 5 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export class TerminalSessionNotFoundError extends Error {
  readonly code = "terminal_session_not_found" as const;
}

export class TerminalLeaseKindError extends Error {
  readonly code = "terminal_lease_required" as const;
}

export type TerminalServiceOptions = {
  workspaceRoot: string;
  leaseManager: LeaseManager;
  maxOutputBytes?: number;
  maxDurationMs?: number;
  idleTimeoutMs?: number;
};

export class TerminalService {
  readonly #options: Required<Omit<TerminalServiceOptions, "leaseManager">> & { leaseManager: LeaseManager };
  readonly #sessions = new Map<string, { leaseId: string; slotId: string; session: TerminalSession }>();

  constructor(options: TerminalServiceOptions) {
    this.#options = {
      ...options,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      maxDurationMs: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    };
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    const lease = this.#options.leaseManager.assertActive(input.leaseId);
    if (lease.kind !== "terminal" && lease.kind !== "agent") throw new TerminalLeaseKindError();
    const cwd = resolveBotPath(lease.botId, ".", this.#options.workspaceRoot);
    await mkdir(cwd, { recursive: true });
    const session = new TerminalSession({
      cwd,
      command: input.command,
      maxOutputBytes: this.#options.maxOutputBytes,
      maxDurationMs: this.#options.maxDurationMs,
      idleTimeoutMs: this.#options.idleTimeoutMs
    });
    this.#sessions.set(session.sessionId, { leaseId: input.leaseId, slotId: lease.slotId, session });
    return session.summary();
  }

  async write(input: TerminalWriteInput): Promise<{ sessionId: string }> {
    this.#get(input.leaseId, input.sessionId).write(input.input);
    return { sessionId: input.sessionId };
  }

  async read(input: TerminalReadInput): Promise<TerminalReadResult> {
    return this.#get(input.leaseId, input.sessionId).read(input.cursor, input.maxBytes);
  }

  async terminate(input: TerminalTerminateInput): Promise<{ sessionId: string }> {
    this.#get(input.leaseId, input.sessionId).terminate();
    return { sessionId: input.sessionId };
  }

  async releaseSlot(slotId: string): Promise<void> {
    for (const record of this.#sessions.values()) {
      if (record.slotId === slotId) record.session.terminate();
    }
  }

  async dispose(): Promise<void> {
    for (const record of this.#sessions.values()) record.session.terminate();
    this.#sessions.clear();
  }

  #get(leaseId: string, sessionId: string): TerminalSession {
    const lease = this.#options.leaseManager.assertActive(leaseId);
    if (lease.kind !== "terminal" && lease.kind !== "agent") throw new TerminalLeaseKindError();
    const record = this.#sessions.get(sessionId);
    if (!record || record.leaseId !== leaseId) throw new TerminalSessionNotFoundError();
    return record.session;
  }
}
