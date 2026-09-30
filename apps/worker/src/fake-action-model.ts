import type { AgentAction } from "@vork/contracts";

export type ActionModelContext = {
  botId: string;
  conversationId: string;
  userMessage: string;
  turn: number;
  /** 上一轮工具观察（截断后），供后续真模型使用 */
  lastObservation?: string;
  signal?: AbortSignal;
};

export type ActionModel = {
  nextAction(ctx: ActionModelContext): Promise<AgentAction>;
};

/** 确定性动作序列，用于 Agent 循环自动化（非流式聊天 FakeModel） */
export class FakeActionModel implements ActionModel {
  constructor(private readonly actions: readonly AgentAction[]) {
    if (actions.length === 0) throw new Error("FakeActionModel requires at least one action");
  }

  async nextAction(ctx: ActionModelContext): Promise<AgentAction> {
    const index = ctx.turn - 1;
    if (index < 0 || index >= this.actions.length) {
      return { type: "task.fail", errorCode: "FAKE_ACTIONS_EXHAUSTED" };
    }
    return this.actions[index]!;
  }
}

const AGENT_FILE_MARKER = "[agent-file]";
const AGENT_TERMINAL_MARKER = "[agent-terminal]";
const AGENT_PAUSE_MARKER = "[agent-pause]";
const AGENT_UNCERTAIN_MARKER = "[agent-uncertain]";

export function isAgentFileMessage(content: string): boolean {
  return content.includes(AGENT_FILE_MARKER);
}

export function isAgentTerminalMessage(content: string): boolean {
  return content.includes(AGENT_TERMINAL_MARKER);
}

export function isAgentPauseMessage(content: string): boolean {
  return content.includes(AGENT_PAUSE_MARKER);
}

export function isAgentUncertainMessage(content: string): boolean {
  return content.includes(AGENT_UNCERTAIN_MARKER);
}

export function createAgentPauseDemoModel(delayMs = 800): ActionModel {
  const model = new FakeActionModel(createAgentFileDemoActions());
  return {
    async nextAction(ctx) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return model.nextAction(ctx);
    }
  };
}

export function createAgentUncertainDemoModel(): ActionModel {
  return new FakeActionModel([
    { type: "file.write", path: "notes/uncertain-demo.txt", content: "uncertain demo" },
    { type: "message.reply", text: "已处理结果不确定的文件操作。" },
    { type: "task.complete" }
  ]);
}

export function createAgentTerminalDemoModel(): ActionModel {
  return {
    async nextAction(ctx) {
      if (ctx.turn === 1) {
        return {
          type: "terminal.start",
          command: "printf 'hello from vork terminal\\n' > terminal-demo.txt && cat terminal-demo.txt"
        };
      }
      if (ctx.turn === 2) {
        const sessionId = ctx.lastObservation?.match(/terminal\s+(terminal_[^\s]+)\s+started/)?.[1];
        return sessionId
          ? { type: "terminal.read", sessionId, cursor: 0 }
          : { type: "task.fail", errorCode: "TERMINAL_SESSION_MISSING" };
      }
      if (ctx.turn === 3) {
        return { type: "message.reply", text: "已通过受控终端创建并读取 terminal-demo.txt。" };
      }
      return { type: "task.complete" };
    }
  };
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
