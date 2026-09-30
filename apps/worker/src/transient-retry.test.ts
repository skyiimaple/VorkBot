import { describe, expect, it, vi } from "vitest";
import { classifyTransientFailure, runWithTransientRetry, TransientOperationError } from "./transient-retry.js";

describe("bounded transient retry", () => {
  it("uses exactly 1/2/4 second delays before succeeding", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await runWithTransientRetry(async () => {
      attempts += 1;
      if (attempts < 4) throw new TransientOperationError("MODEL_5XX");
      return "ok";
    }, { sleep: async (ms) => void delays.push(ms) });
    expect(result).toBe("ok");
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("does not retry an uncertain side effect or deterministic client error", async () => {
    expect(classifyTransientFailure(new Error("connection reset"), "tool", "side_effect", true)).toBe(false);
    expect(classifyTransientFailure(new Error("http 400"), "model", "safe", false)).toBe(false);
    const operation = vi.fn(async () => { throw new Error("policy denied"); });
    await expect(runWithTransientRetry(operation, { sleep: async () => undefined })).rejects.toThrow("policy denied");
    expect(operation).toHaveBeenCalledOnce();
  });
});
