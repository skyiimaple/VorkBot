import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { TerminalReadResult, TerminalStartResult, TerminalStatus } from "@vork/contracts";

export type TerminalSessionOptions = {
  cwd: string;
  command?: string;
  maxOutputBytes: number;
  maxDurationMs: number;
  idleTimeoutMs: number;
};

export class TerminalSession {
  readonly sessionId = `terminal_${randomUUID()}`;
  readonly startedAt = new Date();
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #maxOutputBytes: number;
  readonly #maxDurationTimer: ReturnType<typeof setTimeout>;
  readonly #idleTimeoutMs: number;
  #idleTimer: ReturnType<typeof setTimeout>;
  #buffer = Buffer.alloc(0);
  #baseCursor = 0;
  #nextCursor = 0;
  #status: TerminalStatus = "running";
  #exitCode: number | null | undefined;

  constructor(options: TerminalSessionOptions) {
    this.#maxOutputBytes = options.maxOutputBytes;
    this.#idleTimeoutMs = options.idleTimeoutMs;
    const invocation = terminalInvocation(options.command);
    this.#process = spawn(invocation.file, invocation.args, {
      cwd: options.cwd,
      detached: true,
      env: { ...process.env, HOME: options.cwd, PWD: options.cwd },
      stdio: "pipe"
    });
    this.#process.stdout.on("data", (chunk: Buffer) => this.#append(chunk));
    this.#process.stderr.on("data", (chunk: Buffer) => this.#append(chunk));
    this.#process.on("exit", (code) => {
      if (this.#status === "running") this.#status = "exited";
      this.#exitCode = code;
      this.#clearTimers();
    });
    this.#maxDurationTimer = setTimeout(() => this.terminate(), options.maxDurationMs);
    this.#maxDurationTimer.unref();
    this.#idleTimer = this.#newIdleTimer();
  }

  summary(): TerminalStartResult {
    return { sessionId: this.sessionId, status: this.#status, startedAt: this.startedAt.toISOString() };
  }

  write(input: string): void {
    if (this.#status !== "running") throw new TerminalNotRunningError();
    this.#process.stdin.write(input);
    this.#touch();
  }

  read(cursor = 0, maxBytes = 65_536): TerminalReadResult {
    const effectiveCursor = Math.max(cursor, this.#baseCursor);
    const offset = effectiveCursor - this.#baseCursor;
    const available = this.#buffer.subarray(offset, Math.min(this.#buffer.length, offset + maxBytes));
    const nextCursor = effectiveCursor + available.byteLength;
    this.#touch();
    return {
      sessionId: this.sessionId,
      output: available.toString("utf8"),
      nextCursor,
      truncated: cursor < this.#baseCursor || nextCursor < this.#nextCursor,
      status: this.#status,
      ...(this.#exitCode !== undefined ? { exitCode: this.#exitCode } : {})
    };
  }

  terminate(): void {
    if (this.#status !== "running") return;
    this.#status = "terminated";
    this.#clearTimers();
    const pid = this.#process.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        this.#process.kill("SIGTERM");
      }
    }
  }

  #append(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    this.#nextCursor += chunk.byteLength;
    if (this.#buffer.byteLength > this.#maxOutputBytes) {
      const removed = this.#buffer.byteLength - this.#maxOutputBytes;
      this.#buffer = this.#buffer.subarray(removed);
      this.#baseCursor += removed;
    }
    this.#touch();
  }

  #touch(): void {
    if (this.#status !== "running") return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = this.#newIdleTimer();
  }

  #newIdleTimer(): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.terminate(), this.#idleTimeoutMs);
    timer.unref();
    return timer;
  }

  #clearTimers(): void {
    clearTimeout(this.#maxDurationTimer);
    clearTimeout(this.#idleTimer);
  }
}

function terminalInvocation(command: string | undefined): { file: string; args: string[] } {
  if (process.platform === "darwin") {
    return {
      file: "/bin/sh",
      args: command ? ["-lc", command] : []
    };
  }
  return {
    file: "/usr/bin/script",
    args: command ? ["-qefc", command, "/dev/null"] : ["-qef", "/dev/null"]
  };
}

export class TerminalNotRunningError extends Error {
  readonly code = "terminal_not_running" as const;
}
