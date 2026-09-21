import type { AgentAction } from "@vork/contracts";

export type ActionModelContext = {
  botId: string;
  conversationId: string;
  userMessage: string;
  turn: number;
  /** 上一轮工具观察（截断后），供后续真模型使用 */
  lastObservation?: string;
};

export type ActionModel = {
  nextAction(ctx: ActionModelContext): Promise<AgentAction>;
};

/** 确定性动作序列，用于 Agent 循环自动化（非流式聊天 FakeModel） */
export class FakeActionModel implements ActionModel {
  private index = 0;

  constructor(private readonly actions: readonly AgentAction[]) {
    if (actions.length === 0) throw new Error("FakeActionModel requires at least one action");
  }

  async nextAction(_ctx: ActionModelContext): Promise<AgentAction> {
    if (this.index >= this.actions.length) {
      return { type: "task.fail", errorCode: "FAKE_ACTIONS_EXHAUSTED" };
    }
    const action = this.actions[this.index]!;
    this.index += 1;
    return action;
  }
}

const AGENT_FILE_MARKER = "[agent-file]";

export function isAgentFileMessage(content: string): boolean {
  return content.includes(AGENT_FILE_MARKER);
}

/** `[agent-file]` 默认剧本：写 → 读 → 回复 → 完成 */
export function createAgentFileDemoActions(): AgentAction[] {
  return [
    {
      type: "file.write",
      path: "notes/agent-hello.txt",
      content: "你好，来自受控 Agent 循环。"
    },
    { type: "file.read", path: "notes/agent-hello.txt" },
    {
      type: "message.reply",
      text: "已通过 Agent 循环写入并读取 notes/agent-hello.txt。"
    },
    { type: "task.complete" }
  ];
}
