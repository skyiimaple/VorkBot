import { LeaseExpiredError, type LeaseManager } from "../slots/lease-manager.js";
import { BrowserSessionRegistry, type ObserveResult } from "./session.js";

export class BrowserKindError extends Error {
  readonly code = "invalid_slot_kind" as const;

  constructor() {
    super("invalid_slot_kind");
    this.name = "BrowserKindError";
  }
}

export class StaleElementRefError extends Error {
  readonly code = "stale_element_ref" as const;

  constructor() {
    super("stale_element_ref");
    this.name = "StaleElementRefError";
  }
}

export class BrowserUnavailableError extends Error {
  readonly code = "browser_unavailable" as const;

  constructor() {
    super("browser_unavailable");
    this.name = "BrowserUnavailableError";
  }
}

export type BrowserServiceOptions = {
  leaseManager: LeaseManager;
  sessionRegistry: BrowserSessionRegistry;
};

export class BrowserService {
  readonly #leaseManager: LeaseManager;
  readonly #sessions: BrowserSessionRegistry;

  constructor(options: BrowserServiceOptions) {
    this.#leaseManager = options.leaseManager;
    this.#sessions = options.sessionRegistry;
  }

  async observe(input: { leaseId: string }): Promise<ObserveResult> {
    const session = await this.#sessionForLease(input.leaseId);
    await session.start();
    return session.observe();
  }

  async navigate(input: { leaseId: string; url: string }): Promise<{ url: string }> {
    const session = await this.#sessionForLease(input.leaseId);
    await session.start();
    await session.navigate(input.url);
    return { url: input.url };
  }

  async click(input: { leaseId: string; ref: string }): Promise<{ ref: string }> {
    const session = await this.#sessionForLease(input.leaseId);
    await session.start();
    try {
      await session.click(input.ref);
    } catch (error) {
      if (error instanceof Error && error.message === "stale_element_ref") {
        throw new StaleElementRefError();
      }
      throw error;
    }
    return { ref: input.ref };
  }

  async type(input: { leaseId: string; ref: string; text: string }): Promise<{ ref: string }> {
    const session = await this.#sessionForLease(input.leaseId);
    await session.start();
    try {
      await session.type(input.ref, input.text);
    } catch (error) {
      if (error instanceof Error && error.message === "stale_element_ref") {
        throw new StaleElementRefError();
      }
      throw error;
    }
    return { ref: input.ref };
  }

  async scroll(input: { leaseId: string; deltaY?: number }): Promise<{ deltaY: number }> {
    const session = await this.#sessionForLease(input.leaseId);
    await session.start();
    const deltaY = input.deltaY ?? 400;
    await session.scroll(deltaY);
    return { deltaY };
  }

  async releaseSlot(slotId: string): Promise<void> {
    await this.#sessions.stop(slotId);
  }

  async #sessionForLease(leaseId: string) {
    const lease = this.#assertBrowserLease(leaseId);
    return this.#sessions.getOrCreate(lease.slotId);
  }

  #assertBrowserLease(leaseId: string) {
    const lease = this.#leaseManager.assertActive(leaseId);
    if (lease.kind !== "browser") {
      throw new BrowserKindError();
    }
    return lease;
  }
}

export function isBrowserServiceError(
  error: unknown
): error is LeaseExpiredError | BrowserKindError | StaleElementRefError | BrowserUnavailableError {
  return (
    error instanceof LeaseExpiredError ||
    error instanceof BrowserKindError ||
    error instanceof StaleElementRefError ||
    error instanceof BrowserUnavailableError
  );
}
