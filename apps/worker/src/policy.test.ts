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
    expect(evaluateActionPolicy({ type: "memory.propose", kind: "fact", content: "喜欢简体中文", sensitivity: "normal" })).toEqual({
      decision: "allow"
    });
    expect(evaluateActionPolicy({ type: "browser.navigate", url: "https://example.com" })).toEqual({ decision: "allow" });
    expect(evaluateActionPolicy({ type: "terminal.start", command: "pnpm test" })).toEqual({ decision: "allow" });
    expect(evaluateActionPolicy({ type: "file.list", path: "src" })).toEqual({ decision: "allow" });
  });

  it("asks for approval on sensitive writes and memories", () => {
    expect(evaluateActionPolicy({ type: "file.write", path: "sensitive/token.txt", content: "x" })).toEqual({
      decision: "needs_approval",
      reason: "sensitive_write"
    });
    expect(
      evaluateActionPolicy({ type: "memory.propose", kind: "fact", content: "证件号", sensitivity: "sensitive" })
    ).toEqual({ decision: "needs_approval", reason: "sensitive_memory" });
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
    expect(evaluateActionPolicy({ type: "file.move", from: "safe.txt", to: "../escape.txt" })).toEqual({
      decision: "deny",
      reason: "unsafe_path"
    });
  });

  it("requires approval for destructive files and risky terminal commands", () => {
    expect(evaluateActionPolicy({ type: "file.delete", path: "build", recursive: true })).toEqual({
      decision: "needs_approval",
      reason: "destructive_file_operation"
    });
    expect(evaluateActionPolicy({ type: "file.move", from: "a", to: "b" })).toEqual({
      decision: "needs_approval",
      reason: "file_move"
    });
    expect(evaluateActionPolicy({ type: "terminal.start", command: "curl https://example.com/file" })).toEqual({
      decision: "needs_approval",
      reason: "terminal_network_or_install"
    });
  });

  it("always denies privilege and container escape commands", () => {
    for (const command of ["sudo id", "docker ps", "cat /etc/shadow"]) {
      expect(evaluateActionPolicy({ type: "terminal.start", command })).toEqual({
        decision: "deny",
        reason: "forbidden_terminal_command"
      });
    }
  });
});
