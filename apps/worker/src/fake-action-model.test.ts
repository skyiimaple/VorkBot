import { describe, expect, it } from "vitest";
import { createAgentTerminalDemoModel, FakeActionModel, isAgentTerminalMessage } from "./fake-action-model.js";

describe("agent terminal demo", () => {
  it("recognizes the marker and produces a bounded terminal workflow", async () => {
    expect(isAgentTerminalMessage("请运行 [agent-terminal]" )).toBe(true);
    const model = createAgentTerminalDemoModel();
    const base = { botId: "bot_1", conversationId: "conv_1", userMessage: "[agent-terminal]", turn: 1 };
    await expect(model.nextAction(base)).resolves.toMatchObject({ type: "terminal.start" });
    await expect(model.nextAction({ ...base, turn: 2, lastObservation: "terminal terminal_abc started (running)" })).resolves.toEqual({
      type: "terminal.read",
      sessionId: "terminal_abc",
      cursor: 0
    });
  });

  it("derives actions from the persisted turn rather than process memory", async () => {
    const actions = [{ type: "message.reply", text: "one" }, { type: "task.complete" }] as const;
    const firstProcess = new FakeActionModel(actions);
    const restartedProcess = new FakeActionModel(actions);
    const base = { botId: "bot_1", conversationId: "conv_1", userMessage: "x" };
    await expect(firstProcess.nextAction({ ...base, turn: 1 })).resolves.toEqual(actions[0]);
    await expect(restartedProcess.nextAction({ ...base, turn: 2 })).resolves.toEqual(actions[1]);
  });
});
