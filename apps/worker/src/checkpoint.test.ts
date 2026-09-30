import { describe, expect, it } from "vitest";
import { sanitizeCheckpointObservation, toCheckpointState } from "./checkpoint.js";

describe("agent checkpoint", () => {
  it("redacts credentials and bounds observations", () => {
    const source = `Authorization: Bearer secret-token\nCookie: session=abc\n${"x".repeat(5000)}`;
    const value = sanitizeCheckpointObservation(source);
    expect(value).not.toContain("secret-token");
    expect(value).not.toContain("session=abc");
    expect(value.length).toBeLessThanOrEqual(4000);
  });

  it("serializes the next turn and counters", () => {
    expect(toCheckpointState({ nextTurn: 3, lastObservation: "ok", reply: "done", modelTurns: 2, toolCalls: 1, lastCompletedToolCallId: "tool_1" })).toEqual({
      nextTurn: 3,
      lastObservation: "ok",
      reply: "done",
      modelTurns: 2,
      toolCalls: 1,
      lastCompletedToolCallId: "tool_1"
    });
  });
});
