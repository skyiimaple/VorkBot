import { randomUUID } from "node:crypto";
import type { AcquireSlotInput, ComputerError, SlotLease } from "@vork/contracts";
import type { MemoryPressureReader } from "../system/memory-pressure.js";

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_BROWSER_SLOTS = 2;

export class LeaseExpiredError extends Error {
  readonly code = "lease_expired" as const;

  constructor() {
    super("lease_expired");
    this.name = "LeaseExpiredError";
  }
}

type LeaseRecord = {
  leaseId: string;
  slotId: string;
  taskId: string;
  botId: string;
  kind: AcquireSlotInput["kind"];
  expiresAt: Date;
};

export type LeaseManagerOptions = {
  maxSlots: number;
  maxBrowserSlots?: number;
  ttlMs?: number;
  isMemoryPressure?: MemoryPressureReader;
};

function isComputerError(result: SlotLease | ComputerError | void): result is ComputerError {
  return result !== undefined && "code" in result;
}

export class LeaseManager {
  readonly #maxSlots: number;
  readonly #maxBrowserSlots: number;
  readonly #ttlMs: number;
  readonly #isMemoryPressure: MemoryPressureReader;
  readonly #leases = new Map<string, LeaseRecord>();
  readonly #slotToLeaseId = new Map<string, string>();

  constructor(options: LeaseManagerOptions) {
    this.#maxSlots = options.maxSlots;
    this.#maxBrowserSlots = options.maxBrowserSlots ?? DEFAULT_MAX_BROWSER_SLOTS;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#isMemoryPressure = options.isMemoryPressure ?? (() => false);
  }

  acquire(input: AcquireSlotInput): SlotLease | ComputerError {
    this.#purgeExpiredSlots();

    if (input.kind === "browser") {
      if (this.#isMemoryPressure()) {
        return { code: "memory_pressure" };
      }
      if (this.#activeBrowserCount() >= this.#maxBrowserSlots) {
        return { code: "browser_concurrency_limit" };
      }
    }

    const slotId = this.#findAvailableSlot();
    if (!slotId) {
      return { code: "no_slot" };
    }

    const leaseId = randomUUID();
    const expiresAt = new Date(Date.now() + this.#ttlMs);
    const record: LeaseRecord = {
      leaseId,
      slotId,
      taskId: input.taskId,
      botId: input.botId,
      kind: input.kind,
      expiresAt
    };

    this.#leases.set(leaseId, record);
    this.#slotToLeaseId.set(slotId, leaseId);

    return this.#toSlotLease(record);
  }

  heartbeat(leaseId: string): void | ComputerError {
    const record = this.#leases.get(leaseId);
    if (!record || this.#isExpired(record)) {
      return { code: "lease_expired" };
    }

    record.expiresAt = new Date(Date.now() + this.#ttlMs);
    return undefined;
  }

  release(leaseId: string): SlotLease & { slotId: string; kind: LeaseRecord["kind"] } | undefined {
    const record = this.#leases.get(leaseId);
    if (!record) {
      return undefined;
    }

    this.#leases.delete(leaseId);
    if (this.#slotToLeaseId.get(record.slotId) === leaseId) {
      this.#slotToLeaseId.delete(record.slotId);
    }

    return {
      ...this.#toSlotLease(record),
      slotId: record.slotId,
      kind: record.kind
    };
  }

  assertActive(leaseId: string): SlotLease & { botId: string; taskId: string; kind: LeaseRecord["kind"] } {
    const record = this.#leases.get(leaseId);
    if (!record || this.#isExpired(record)) {
      throw new LeaseExpiredError();
    }

    return {
      ...this.#toSlotLease(record),
      botId: record.botId,
      taskId: record.taskId,
      kind: record.kind
    };
  }

  #activeBrowserCount(): number {
    let count = 0;
    for (const leaseId of this.#slotToLeaseId.values()) {
      const record = this.#leases.get(leaseId);
      if (record && !this.#isExpired(record) && record.kind === "browser") {
        count += 1;
      }
    }
    return count;
  }

  #findAvailableSlot(): string | undefined {
    for (let index = 1; index <= this.#maxSlots; index += 1) {
      const slotId = `slot_${index}`;
      const activeLeaseId = this.#slotToLeaseId.get(slotId);
      if (!activeLeaseId) {
        return slotId;
      }

      const record = this.#leases.get(activeLeaseId);
      if (!record || this.#isExpired(record)) {
        this.#slotToLeaseId.delete(slotId);
        if (record) {
          this.#leases.delete(activeLeaseId);
        }
        return slotId;
      }
    }

    return undefined;
  }

  #purgeExpiredSlots(): void {
    for (const [slotId, leaseId] of this.#slotToLeaseId.entries()) {
      const record = this.#leases.get(leaseId);
      if (!record || this.#isExpired(record)) {
        this.#slotToLeaseId.delete(slotId);
        if (record) {
          this.#leases.delete(leaseId);
        }
      }
    }
  }

  #isExpired(record: LeaseRecord): boolean {
    return record.expiresAt.getTime() <= Date.now();
  }

  #toSlotLease(record: LeaseRecord): SlotLease {
    return {
      slotId: record.slotId,
      leaseId: record.leaseId,
      expiresAt: record.expiresAt.toISOString()
    };
  }
}

export { isComputerError };
