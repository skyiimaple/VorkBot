import type { ToolCallRisk } from "@vork/contracts";

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export class TransientOperationError extends Error {
  constructor(readonly code: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "TransientOperationError";
  }
}

export function classifyTransientFailure(
  error: unknown,
  phase: "model" | "tool",
  risk: ToolCallRisk,
  executionStarted: boolean
): boolean {
  if (phase === "tool" && risk === "side_effect" && executionStarted) return false;
  if (error instanceof TransientOperationError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/http\s+429|http\s+5\d\d/.test(message)) return true;
  if (/connection (?:reset|refused)|econnreset|econnrefused|fetch failed/.test(message)) return true;
  return false;
}

export async function runWithTransientRetry<T>(
  operation: () => Promise<T>,
  options: {
    shouldRetry?: (error: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, delayMs: number, error: unknown) => Promise<void> | void;
  } = {}
): Promise<T> {
  const shouldRetry = options.shouldRetry ?? ((error) => error instanceof TransientOperationError);
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !shouldRetry(error)) throw error;
      await options.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }
}
