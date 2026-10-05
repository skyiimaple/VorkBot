import { describe, expect, it, vi } from "vitest";
import { createAgentsComputerExecutor } from "./agents-computer-executor.js";

function fixtures() {
  const repos = {
    appendTaskEvent: vi.fn(async () => ({})),
    prepareToolCall: vi.fn(async (_input: { turn: number }) => ({
      id: "call_1", taskId: "task_1", userId: "user_local", turn: 1, attempt: 0,
      action: { type: "file.read", path: "notes.txt" }, risk: "safe", status: "prepared",
      observation: null, errorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    })),
    markToolCallExecuting: vi.fn(async () => ({})),
    finishToolCallAndCheckpoint: vi.fn(async () => ({})),
    markToolCallUncertain: vi.fn(async () => ({})),
    scheduleTaskRetry: vi.fn(async () => ({})),
    clearTaskRetry: vi.fn(async () => ({})),
    requestApproval: vi.fn(async () => ({})),
    claimApprovedActionForResume: vi.fn(async (): Promise<{
      id: string; reason: string; action: unknown;
    } | null> => null)
  };
  const computer = {
    acquire: vi.fn(async () => ({ leaseId: "lease_1", slotId: "slot_1", expiresAt: new Date(Date.now() + 60_000).toISOString() })),
    heartbeat: vi.fn(async () => ({ leaseId: "lease_1", slotId: "slot_1", expiresAt: new Date(Date.now() + 60_000).toISOString() })),
    release: vi.fn(async () => {}),
    readFile: vi.fn(async () => ({ path: "notes.txt", content: "hello", truncated: false })),
    writeFile: vi.fn(), listFiles: vi.fn(), statFile: vi.fn(), makeDirectory: vi.fn(), moveFile: vi.fn(), deleteFile: vi.fn(),
    navigate: vi.fn(async (_leaseId: string, url: string) => ({ url })), observe: vi.fn(), click: vi.fn(), type: vi.fn(), scroll: vi.fn(),
    startTerminal: vi.fn(), writeTerminal: vi.fn(), readTerminal: vi.fn(), terminateTerminal: vi.fn()
  };
  return { repos, computer, notifier: { notify: vi.fn(async () => {}) } };
}

describe("createAgentsComputerExecutor", () => {
  it("does not acquire a slot until a computer tool is called and reuses one lease", async () => {
    const deps = fixtures();
    const executor = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      ...deps
    } as never);

    expect(deps.computer.acquire).not.toHaveBeenCalled();
    await executor.execute({ type: "file.read", path: "notes.txt" });
    await executor.execute({ type: "browser.navigate", url: "https://example.com" });
    await executor.close();

    expect(deps.computer.acquire).toHaveBeenCalledTimes(1);
    expect(deps.computer.release).toHaveBeenCalledWith("lease_1");
  });

  it("denies forbidden actions before acquiring a slot", async () => {
    const deps = fixtures();
    const executor = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      ...deps
    } as never);

    await expect(executor.execute({ type: "file.read", path: "../secret" }))
      .rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(deps.computer.acquire).not.toHaveBeenCalled();
  });

  it("requests approval without executing a sensitive action", async () => {
    const deps = fixtures();
    const executor = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      ...deps
    } as never);

    await expect(executor.execute({ type: "file.delete", path: "notes.txt" }))
      .rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(deps.repos.requestApproval).toHaveBeenCalledWith({
      taskId: "task_1",
      reason: "destructive_file_operation",
      action: { type: "file.delete", path: "notes.txt" }
    });
    expect(deps.computer.acquire).not.toHaveBeenCalled();
  });

  it("executes an already approved action without requesting approval again", async () => {
    const deps = fixtures();
    deps.repos.claimApprovedActionForResume.mockResolvedValueOnce({
      id: "approval_1",
      reason: "destructive_file_operation",
      action: { type: "file.delete", path: "notes.txt" }
    });
    deps.computer.deleteFile.mockResolvedValueOnce({ path: "notes.txt" });
    const executor = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      ...deps
    } as never);

    const observation = await executor.resumeApprovedAction();
    await executor.close();

    expect(observation).toBe("deleted notes.txt");
    expect(deps.repos.requestApproval).not.toHaveBeenCalled();
    expect(deps.computer.deleteFile).toHaveBeenCalledWith("lease_1", "notes.txt", undefined);
  });

  it("continues tool numbering from a prior checkpoint after restart", async () => {
    const deps = fixtures();
    const first = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      ...deps
    } as never);
    await first.execute({ type: "file.read", path: "notes.txt" });
    await first.close();

    const restarted = createAgentsComputerExecutor({
      task: { id: "task_1", userId: "user_local", botId: "bot_1" },
      initialTurn: 1,
      ...deps
    } as never);
    await restarted.execute({ type: "file.read", path: "notes.txt" });
    await restarted.close();

    expect(deps.repos.prepareToolCall.mock.calls.map(([call]) => call.turn)).toEqual([1, 2]);
  });
});
