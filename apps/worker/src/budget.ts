import type { TaskBudget } from "@vork/contracts";

export type BudgetExceededReason = "max_model_turns" | "max_tool_calls" | "max_duration_ms";

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED" as const;

  constructor(
    readonly reason: BudgetExceededReason,
    readonly budget: TaskBudget,
    readonly modelTurns: number,
    readonly toolCalls: number,
    readonly elapsedMs: number
  ) {
    super(`budget exceeded: ${reason}`);
    this.name = "BudgetExceededError";
  }
}

export type BudgetTracker = {
  recordModelTurn(): void;
  recordToolCall(): void;
  assertWithinBudget(startedAtMs: number, nowMs?: number): void;
  snapshot(startedAtMs: number, nowMs?: number): {
    modelTurns: number;
    toolCalls: number;
    elapsedMs: number;
    budget: TaskBudget;
  };
};

export function createBudgetTracker(budget: TaskBudget): BudgetTracker {
  let modelTurns = 0;
  let toolCalls = 0;

  return {
    recordModelTurn() {
      modelTurns += 1;
    },
    recordToolCall() {
      toolCalls += 1;
    },
    assertWithinBudget(startedAtMs, nowMs = Date.now()) {
      const elapsedMs = Math.max(0, nowMs - startedAtMs);
      if (modelTurns > budget.maxModelTurns) {
        throw new BudgetExceededError("max_model_turns", budget, modelTurns, toolCalls, elapsedMs);
      }
      if (toolCalls > budget.maxToolCalls) {
        throw new BudgetExceededError("max_tool_calls", budget, modelTurns, toolCalls, elapsedMs);
      }
      if (elapsedMs > budget.maxDurationMs) {
        throw new BudgetExceededError("max_duration_ms", budget, modelTurns, toolCalls, elapsedMs);
      }
    },
    snapshot(startedAtMs, nowMs = Date.now()) {
      return {
        modelTurns,
        toolCalls,
        elapsedMs: Math.max(0, nowMs - startedAtMs),
        budget
      };
    }
  };
}
