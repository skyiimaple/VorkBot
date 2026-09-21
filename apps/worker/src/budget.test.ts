import { describe, expect, it } from "vitest";
import { BudgetExceededError, createBudgetTracker } from "./budget.js";

const budget = { maxModelTurns: 2, maxToolCalls: 3, maxDurationMs: 1000 };

describe("createBudgetTracker", () => {
  it("allows turns and tools within limits", () => {
    const tracker = createBudgetTracker(budget);
    tracker.recordModelTurn();
    tracker.recordToolCall();
    expect(() => tracker.assertWithinBudget(0, 500)).not.toThrow();
  });

  it("throws when model turns exceed max", () => {
    const tracker = createBudgetTracker(budget);
    tracker.recordModelTurn();
    tracker.recordModelTurn();
    tracker.recordModelTurn();
    expect(() => tracker.assertWithinBudget(0, 100)).toThrow(BudgetExceededError);
    try {
      tracker.assertWithinBudget(0, 100);
    } catch (error) {
      expect(error).toMatchObject({ code: "BUDGET_EXCEEDED", reason: "max_model_turns" });
    }
  });

  it("throws when duration exceeds max", () => {
    const tracker = createBudgetTracker(budget);
    expect(() => tracker.assertWithinBudget(0, 1001)).toThrow(BudgetExceededError);
  });
});
