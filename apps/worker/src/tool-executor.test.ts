import type { AgentToolAction, ToolCall } from "@vork/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentComputerClientLike } from "./computer-client.js";
import { createToolExecutionState, executeToolAction } from "./tool-executor.js";

describe("executeToolAction", () => {
  const savedCall: ToolCall = {
    id: "tool_saved", taskId: "task_1", userId: "user_local", turn: 1, attempt: 0,
    action: { type: "file.write", path: "notes.txt", content: "hello" }, risk: "side_effect", status: "succeeded",
    observation: "wrote notes.txt (5 bytes)", errorCode: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };

  it("replays a saved result without repeating a successful side effect", async () => {
    const { deps, computer } = createDependencies();
    const observation = await executeToolAction(savedCall.action as AgentToolAction, { ...deps, userId: "user_local", existingToolCall: savedCall });
    expect(observation).toBe("wrote notes.txt (5 bytes)");
    expect(computer.writeFile).not.toHaveBeenCalled();
  });

  it("does not repeat a side effect whose previous execution outcome is unknown", async () => {
    const { deps, computer } = createDependencies();
    await expect(executeToolAction(savedCall.action as AgentToolAction, { ...deps, userId: "user_local", existingToolCall: { ...savedCall, status: "executing", observation: null } })).rejects.toMatchObject({ toolCallId: "tool_saved" });
    expect(computer.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: "browser.navigate", url: "https://example.com" }, "navigate", ["lease_1", "https://example.com"]],
    [{ type: "file.mkdir", path: "src" }, "makeDirectory", ["lease_1", "src"]],
    [{ type: "file.move", from: "a", to: "b" }, "moveFile", ["lease_1", "a", "b"]],
    [{ type: "file.delete", path: "tmp", recursive: true }, "deleteFile", ["lease_1", "tmp", true]]
  ] as const)("dispatches %s to ComputerClient.%s", async (action, method, args) => {
    const { deps, computer } = createDependencies();
    await executeToolAction(action as AgentToolAction, deps);
    expect(computer[method]).toHaveBeenCalledWith(...args);
  });

  it("keeps the next terminal cursor between reads", async () => {
    const { deps, computer } = createDependencies();
    computer.readTerminal
      .mockResolvedValueOnce({ sessionId: "term_1", output: "first", nextCursor: 5, truncated: false, status: "running" })
      .mockResolvedValueOnce({ sessionId: "term_1", output: "second", nextCursor: 11, truncated: false, status: "exited", exitCode: 0 });

    await executeToolAction({ type: "terminal.read", sessionId: "term_1" }, deps);
    await executeToolAction({ type: "terminal.read", sessionId: "term_1" }, deps);

    expect(computer.readTerminal).toHaveBeenNthCalledWith(1, "lease_1", "term_1", 0);
    expect(computer.readTerminal).toHaveBeenNthCalledWith(2, "lease_1", "term_1", 5);
  });
});

function createDependencies() {
  const methods = {
    acquire: vi.fn(), heartbeat: vi.fn(), release: vi.fn(),
    writeFile: vi.fn(async (_leaseId: string, path: string, content: string) => ({ path, bytes: content.length })),
    readFile: vi.fn(async (_leaseId: string, path: string) => ({ path, content: "content", bytes: 7 })),
    listFiles: vi.fn(async () => ({ entries: [] })),
    statFile: vi.fn(async (_leaseId: string, path: string) => ({ path, type: "file" as const, size: 1, modifiedAt: new Date(0).toISOString() })),
    makeDirectory: vi.fn(async (_leaseId: string, path: string) => ({ path })),
    moveFile: vi.fn(async (_leaseId: string, from: string, to: string) => ({ from, to })),
    deleteFile: vi.fn(async (_leaseId: string, path: string) => ({ path })),
    observe: vi.fn(async () => ({ pageId: "p", url: "about:blank", title: "Blank", loadState: "loaded" as const, elements: [], consoleErrors: [] })),
    navigate: vi.fn(async (_leaseId: string, url: string) => ({ url })),
    click: vi.fn(async (_leaseId: string, ref: string) => ({ ref })),
    type: vi.fn(async (_leaseId: string, ref: string) => ({ ref })),
    scroll: vi.fn(async (_leaseId: string, deltaY: number) => ({ deltaY })),
    startTerminal: vi.fn(async () => ({ sessionId: "term_1", status: "running" as const, startedAt: new Date(0).toISOString() })),
    writeTerminal: vi.fn(async (_leaseId: string, sessionId: string) => ({ sessionId })),
    readTerminal: vi.fn(),
    terminateTerminal: vi.fn(async (_leaseId: string, sessionId: string) => ({ sessionId }))
  };
  const computer = methods as unknown as AgentComputerClientLike & typeof methods;
  const deps = {
    taskId: "task_1",
    leaseId: "lease_1",
    computer,
    repos: { appendTaskEvent: vi.fn(async () => ({ sequence: 1 })), finishToolCallAndCheckpoint: vi.fn(async () => ({})) },
    notifier: { notify: vi.fn(async () => undefined) },
    state: createToolExecutionState(),
    checkpoint: () => ({ nextTurn: 2, lastObservation: "", reply: "", modelTurns: 1, toolCalls: 1, lastCompletedToolCallId: "tool_saved" })
  } as unknown as Parameters<typeof executeToolAction>[1];
  return { deps, computer };
}
