import {
  AcquireSlotInputSchema,
  FileReadResultSchema,
  SlotLeaseSchema,
  TerminalReadResultSchema,
  TerminalStartResultSchema,
  type AcquireSlotInput,
  type FileReadResult,
  type SlotLease,
  type TerminalReadResult,
  type TerminalStartResult
} from "@vork/contracts";
import { z } from "zod";

const ComputerErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional()
});

export type ComputerClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

const ObserveResultSchema = z.object({
  pageId: z.string(),
  url: z.string(),
  title: z.string(),
  loadState: z.enum(["loading", "loaded", "unknown"]),
  elements: z.array(
    z.object({
      ref: z.string(),
      role: z.string().optional(),
      name: z.string().optional(),
      tag: z.string().optional(),
      testId: z.string().optional()
    })
  ),
  consoleErrors: z.array(z.string())
});

export type ObserveResult = z.infer<typeof ObserveResultSchema>;

export interface ComputerClientLike {
  acquire(input: AcquireSlotInput): Promise<SlotLease>;
  heartbeat(leaseId: string): Promise<SlotLease>;
  release(leaseId: string): Promise<void>;
  writeFile(leaseId: string, path: string, content: string): Promise<{ path: string; bytes: number }>;
  readFile(leaseId: string, path: string): Promise<FileReadResult>;
  observe(leaseId: string): Promise<ObserveResult>;
  navigate(leaseId: string, url: string): Promise<{ url: string }>;
  click(leaseId: string, ref: string): Promise<{ ref: string }>;
  type(leaseId: string, ref: string, text: string): Promise<{ ref: string }>;
}

export interface AgentComputerClientLike extends ComputerClientLike {
  listFiles(leaseId: string, path?: string): Promise<{ entries: Array<{ name: string; type: "file" | "directory"; size?: number }> }>;
  statFile(leaseId: string, path: string): Promise<{ path: string; type: "file" | "directory"; size: number; modifiedAt: string }>;
  makeDirectory(leaseId: string, path: string): Promise<{ path: string }>;
  moveFile(leaseId: string, from: string, to: string): Promise<{ from: string; to: string }>;
  deleteFile(leaseId: string, path: string, recursive?: boolean): Promise<{ path: string }>;
  scroll(leaseId: string, deltaY: number): Promise<{ deltaY: number }>;
  startTerminal(leaseId: string, command?: string): Promise<TerminalStartResult>;
  writeTerminal(leaseId: string, sessionId: string, input: string): Promise<{ sessionId: string }>;
  readTerminal(leaseId: string, sessionId: string, cursor?: number): Promise<TerminalReadResult>;
  terminateTerminal(leaseId: string, sessionId: string): Promise<{ sessionId: string }>;
}

export class ComputerClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string
  ) {
    super(message ?? code);
  }
}

export class ComputerClient implements ComputerClientLike {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ComputerClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async acquire(input: AcquireSlotInput): Promise<SlotLease> {
    const body = AcquireSlotInputSchema.parse(input);
    const response = await this.request("/v1/slots/acquire", { method: "POST", body: JSON.stringify(body) });
    if (response.status === 503) {
      const error = ComputerErrorResponseSchema.parse(await response.json());
      throw new ComputerClientError(error.code, response.status, error.message);
    }
    if (!response.ok) {
      throw await this.toError(response);
    }
    return SlotLeaseSchema.parse(await response.json());
  }

  async heartbeat(leaseId: string): Promise<SlotLease> {
    const response = await this.request("/v1/slots/heartbeat", {
      method: "POST",
      body: JSON.stringify({ leaseId })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return SlotLeaseSchema.parse(await response.json());
  }

  async release(leaseId: string): Promise<void> {
    const response = await this.request("/v1/slots/release", {
      method: "POST",
      body: JSON.stringify({ leaseId })
    });
    if (response.status !== 204 && !response.ok) {
      throw await this.toError(response);
    }
  }

  async writeFile(leaseId: string, path: string, content: string): Promise<{ path: string; bytes: number }> {
    const response = await this.request("/v1/files/write", {
      method: "POST",
      body: JSON.stringify({ leaseId, path, content, root: "bot" })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return z.object({ path: z.string(), bytes: z.number() }).parse(await response.json());
  }

  async readFile(leaseId: string, path: string): Promise<FileReadResult> {
    const response = await this.request("/v1/files/read", {
      method: "POST",
      body: JSON.stringify({ leaseId, path, root: "bot" })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return FileReadResultSchema.parse(await response.json());
  }

  async listFiles(leaseId: string, path?: string) {
    const response = await this.request("/v1/files/list", { method: "POST", body: JSON.stringify({ leaseId, path }) });
    if (!response.ok) throw await this.toError(response);
    return z.object({ entries: z.array(z.object({ name: z.string(), type: z.enum(["file", "directory"]), size: z.number().optional() })) }).parse(await response.json());
  }

  async statFile(leaseId: string, path: string) {
    const response = await this.request("/v1/files/stat", { method: "POST", body: JSON.stringify({ leaseId, path }) });
    if (!response.ok) throw await this.toError(response);
    return z.object({ path: z.string(), type: z.enum(["file", "directory"]), size: z.number(), modifiedAt: z.string() }).parse(await response.json());
  }

  async makeDirectory(leaseId: string, path: string) {
    return this.simpleJson("/v1/files/mkdir", { leaseId, path }, z.object({ path: z.string() }));
  }

  async moveFile(leaseId: string, from: string, to: string) {
    return this.simpleJson("/v1/files/move", { leaseId, from, to }, z.object({ from: z.string(), to: z.string() }));
  }

  async deleteFile(leaseId: string, path: string, recursive?: boolean) {
    return this.simpleJson("/v1/files/delete", { leaseId, path, recursive }, z.object({ path: z.string() }));
  }

  async observe(leaseId: string): Promise<ObserveResult> {
    const response = await this.request("/v1/browser/observe", {
      method: "POST",
      body: JSON.stringify({ leaseId })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return ObserveResultSchema.parse(await response.json());
  }

  async navigate(leaseId: string, url: string): Promise<{ url: string }> {
    const response = await this.request("/v1/browser/navigate", {
      method: "POST",
      body: JSON.stringify({ leaseId, url })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return z.object({ url: z.string() }).parse(await response.json());
  }

  async click(leaseId: string, ref: string): Promise<{ ref: string }> {
    const response = await this.request("/v1/browser/click", {
      method: "POST",
      body: JSON.stringify({ leaseId, ref })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return z.object({ ref: z.string() }).parse(await response.json());
  }

  async type(leaseId: string, ref: string, text: string): Promise<{ ref: string }> {
    const response = await this.request("/v1/browser/type", {
      method: "POST",
      body: JSON.stringify({ leaseId, ref, text })
    });
    if (!response.ok) {
      throw await this.toError(response);
    }
    return z.object({ ref: z.string() }).parse(await response.json());
  }

  async scroll(leaseId: string, deltaY: number): Promise<{ deltaY: number }> {
    return this.simpleJson("/v1/browser/scroll", { leaseId, deltaY }, z.object({ deltaY: z.number() }));
  }

  async startTerminal(leaseId: string, command?: string): Promise<TerminalStartResult> {
    return this.simpleJson("/v1/terminal/start", { leaseId, command }, TerminalStartResultSchema);
  }

  async writeTerminal(leaseId: string, sessionId: string, input: string): Promise<{ sessionId: string }> {
    return this.simpleJson("/v1/terminal/write", { leaseId, sessionId, input }, z.object({ sessionId: z.string() }));
  }

  async readTerminal(leaseId: string, sessionId: string, cursor?: number): Promise<TerminalReadResult> {
    return this.simpleJson("/v1/terminal/read", { leaseId, sessionId, cursor }, TerminalReadResultSchema);
  }

  async terminateTerminal(leaseId: string, sessionId: string): Promise<{ sessionId: string }> {
    return this.simpleJson("/v1/terminal/terminate", { leaseId, sessionId }, z.object({ sessionId: z.string() }));
  }

  private async simpleJson<T>(path: string, body: unknown, schema: { parse(input: unknown): T }): Promise<T> {
    const response = await this.request(path, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw await this.toError(response);
    return schema.parse(await response.json());
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {})
      }
    });
  }

  private async toError(response: Response): Promise<ComputerClientError> {
    let code = "computer_error";
    try {
      const body = ComputerErrorResponseSchema.parse(await response.json());
      code = body.code;
    } catch {
      // ignore parse failure
    }
    return new ComputerClientError(code, response.status);
  }
}

export function createComputerClientFromEnv(environment = process.env): ComputerClient {
  const baseUrl = environment.VORK_COMPUTER_URL;
  const token = environment.VORK_COMPUTER_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("VORK_COMPUTER_URL and VORK_COMPUTER_TOKEN are required for file tasks");
  }
  return new ComputerClient({ baseUrl, token });
}
