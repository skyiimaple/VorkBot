import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathTraversalError, resolveBotPath, resolveSharedPath } from "./path-sandbox.js";

describe("path-sandbox", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "vork-workspace-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("rejects path traversal", () => {
    expect(() => resolveBotPath("bot_1", "../etc/passwd", workspaceRoot)).toThrow(PathTraversalError);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveBotPath("bot_1", "/etc/passwd", workspaceRoot)).toThrow(PathTraversalError);
  });

  it("resolves bot paths under workspace", () => {
    const absolute = resolveBotPath("bot_1", "notes/readme.txt", workspaceRoot);
    expect(absolute).toBe(join(workspaceRoot, "bots", "bot_1", "notes", "readme.txt"));
  });

  it("resolves shared paths under workspace", () => {
    const absolute = resolveSharedPath("templates/base.txt", workspaceRoot);
    expect(absolute).toBe(join(workspaceRoot, "shared", "templates", "base.txt"));
  });

  it("rejects shared path traversal", () => {
    expect(() => resolveSharedPath("../bots/secret", workspaceRoot)).toThrow(PathTraversalError);
  });
});
