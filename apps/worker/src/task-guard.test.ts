import { describe, expect, it, vi } from "vitest";
import { assertTaskStillActive } from "./task-guard.js";

describe("assertTaskStillActive", () => {
  it("returns false when the task is cancelled", async () => {
    const repos = {
      getTask: vi.fn(async () => ({ id: "task_1", status: "cancelled" }))
    };
    await expect(assertTaskStillActive(repos as never, "task_1")).resolves.toBe(false);
  });

  it("returns true while the task is running", async () => {
    const repos = {
      getTask: vi.fn(async () => ({ id: "task_1", status: "running" }))
    };
    await expect(assertTaskStillActive(repos as never, "task_1")).resolves.toBe(true);
  });
});
