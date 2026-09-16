import { describe, expect, it } from "vitest";
import { ControlStateStore, InvalidControlTransitionError } from "./state.js";

describe("ControlStateStore", () => {
  it("defaults to agent_control", () => {
    const store = new ControlStateStore();
    expect(store.get("slot_1")).toBe("agent_control");
  });

  it("moves from agent_control to human_control on takeover", () => {
    const store = new ControlStateStore();
    expect(store.apply("slot_1", "takeover")).toBe("human_control");
  });

  it("returns agent_control after release from human_control", () => {
    const store = new ControlStateStore();
    store.apply("slot_1", "takeover");
    expect(store.apply("slot_1", "release")).toBe("agent_control");
  });

  it("rejects release while agent_control", () => {
    const store = new ControlStateStore();
    expect(() => store.apply("slot_1", "release")).toThrow(InvalidControlTransitionError);
  });
});
