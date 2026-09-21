import { describe, expect, it } from "vitest";
import { evaluateActionPolicy } from "./policy.js";

describe("evaluateActionPolicy", () => {
  it("allows low-risk actions", () => {
    expect(evaluateActionPolicy({ type: "message.reply", text: "ok" })).toEqual({ decision: "allow" });
    expect(evaluateActionPolicy({ type: "task.complete" })).toEqual({ decision: "allow" });
    expect(evaluateActionPolicy({ type: "file.read", path: "notes/a.txt" })).toEqual({ decision: "allow" });
    expect(evaluateActionPolicy({ type: "file.write", path: "notes/a.txt", content: "x" })).toEqual({
      decision: "allow"
    });
  });

  it("denies unsafe paths", () => {
    expect(evaluateActionPolicy({ type: "file.read", path: "../etc/passwd" })).toEqual({
      decision: "deny",
      reason: "unsafe_path"
    });
    expect(evaluateActionPolicy({ type: "file.write", path: "/abs", content: "x" })).toEqual({
      decision: "deny",
      reason: "unsafe_path"
    });
  });
});
