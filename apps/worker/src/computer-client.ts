import {
  AcquireSlotInputSchema,
  FileReadResultSchema,
  SlotLeaseSchema,
  type AcquireSlotInput,
  type FileReadResult,
  type SlotLease
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

export interface ComputerClientLike {
  acquire(input: AcquireSlotInput): Promise<SlotLease>;
  heartbeat(leaseId: string): Promise<SlotLease>;
  release(leaseId: string): Promise<void>;
  writeFile(leaseId: string, path: string, content: string): Promise<{ path: string; bytes: number }>;
  readFile(leaseId: string, path: string): Promise<FileReadResult>;
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
