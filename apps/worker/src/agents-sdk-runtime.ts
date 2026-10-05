import OpenAI from "openai";
import { sdk, functionCall, type SdkItem } from "./agents-sdk-boundary.js";
import type { AgentToolAction } from "@vork/contracts";
import { AGENTS_COMPUTER_TOOL_DEFINITIONS, parseAgentsComputerToolCall } from "./agents-computer-tools.js";
import { evaluateActionPolicy } from "./policy.js";

export type SdkTurnInput = {
  name: string;
  instructions: string;
  input: SdkItem[];
  state?: string;
  approveCallId?: string;
  signal?: AbortSignal;
  onDelta(delta: string): void | Promise<void>;
  onState(state: string): Promise<void>;
  onApprovalApplied?(callId: string): Promise<void>;
  onToolCall(action: AgentToolAction, callId: string): Promise<string>;
};

export type SdkTurnResult = {
  reply: string;
  state: string;
  history: SdkItem[];
  approval?: { callId: string; action: AgentToolAction; reason: string };
};

export type SdkRuntimeLike = { runTurn(input: SdkTurnInput): Promise<SdkTurnResult> };

export class AgentsSdkRuntime implements SdkRuntimeLike {
  private readonly model: object;
  private readonly deepseek: boolean;

  constructor(options: { client?: OpenAI; apiKey?: string; baseURL?: string; model: string; deepseek?: boolean; timeoutMs?: number }) {
    const client = options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, timeout: options.timeoutMs ?? 60_000, maxRetries: 1 });
    this.model = new sdk.OpenAIChatCompletionsModel(client, options.model);
    this.deepseek = options.deepseek ?? new URL(options.baseURL ?? "https://api.openai.com/v1").hostname === "api.deepseek.com";
  }

  async runTurn(input: SdkTurnInput): Promise<SdkTurnResult> {
    let currentState: (() => string) | undefined;
    let toolQueue = Promise.resolve();
    const tools = AGENTS_COMPUTER_TOOL_DEFINITIONS.map((definition) => sdk.tool({
      name: definition.name,
      description: definition.description,
      parameters: { ...definition.parameters, additionalProperties: true as const },
      strict: false,
      errorFunction: null,
      needsApproval: async (_context, args) => evaluateActionPolicy(parseAgentsComputerToolCall(definition.name, args as Record<string, unknown>)).decision === "needs_approval",
      execute: async (args, _context, details) => {
        const action = parseAgentsComputerToolCall(definition.name, args as Record<string, unknown>);
        const policy = evaluateActionPolicy(action);
        if (policy.decision === "deny") throw new Error(`POLICY_DENIED: ${policy.reason}`);
        const callId = details?.toolCall?.callId;
        if (!callId || !currentState) throw new Error("SDK_TOOL_CALL_STATE_MISSING");
        const execution = toolQueue.then(async () => {
          input.signal?.throwIfAborted();
          await input.onState(currentState!());
          return input.onToolCall(action, callId);
        });
        toolQueue = execution.then(() => {}, () => {});
        return execution;
      }
    }));
    const agent = new sdk.Agent({
      name: input.name,
      instructions: `${input.instructions}\n你可以使用真实的文件、终端和浏览器工具。需要最新信息时使用浏览器访问网页核实，不能编造搜索结果。工具路径相对工作区。终端 start 后需 read 获取输出，未完成可继续 read。需要审批时等待用户操作。`,
      model: this.model,
      modelSettings: { parallelToolCalls: false, ...(this.deepseek ? { providerData: { thinking: { type: "disabled" } } } : {}) },
      tools
    });
    const restored = input.state ? await sdk.RunState.fromString(agent, input.state) : undefined;
    if (restored) currentState = () => restored.toString();
    if (input.approveCallId) {
      const approval = restored?.getInterruptions().find((item) => functionCall(item)?.callId === input.approveCallId);
      if (!approval) throw new Error("SDK_APPROVAL_CALL_MISMATCH");
      restored!.approve(approval);
      await input.onState(restored!.toString());
      await input.onApprovalApplied?.(input.approveCallId);
    }
    const runner = new sdk.Runner({ tracingDisabled: true });
    const result = await runner.run(agent, restored ?? input.input, { stream: true, maxTurns: 30, signal: input.signal });
    currentState = () => result.state.toString();
    try {
      for await (const event of result) {
        if (event.type === "raw_model_stream_event" && event.data?.type === "output_text_delta" && event.data.delta) {
          await input.onDelta(event.data.delta);
        }
      }
      await result.completed;
      const state = result.state.toString();
      await input.onState(state);
      const pending = functionCall(result.interruptions[0]);
      if (pending) {
        const action = parseAgentsComputerToolCall(pending.name, JSON.parse(pending.arguments));
        const policy = evaluateActionPolicy(action);
        return { state, history: result.history, reply: "", approval: { callId: pending.callId, action, reason: policy.decision === "needs_approval" ? policy.reason : "tool_approval" } };
      }
      const reply = result.finalOutput ?? "";
      if (!reply.trim()) throw new Error("SDK_EMPTY_REPLY");
      return { state, history: result.history, reply };
    } catch (error) {
      await input.onState(result.state.toString());
      throw error;
    }
  }
}
