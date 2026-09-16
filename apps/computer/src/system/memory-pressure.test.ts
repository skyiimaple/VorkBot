import { describe, expect, it } from "vitest";
import { createMemoryPressureReader } from "./memory-pressure.js";

describe("createMemoryPressureReader", () => {
  it("returns true when VORK_MEMORY_PRESSURE=1", () => {
    const reader = createMemoryPressureReader({ VORK_MEMORY_PRESSURE: "1" });
    expect(reader()).toBe(true);
  });

  it("returns false by default", () => {
    const reader = createMemoryPressureReader({});
    expect(reader()).toBe(false);
  });
});
