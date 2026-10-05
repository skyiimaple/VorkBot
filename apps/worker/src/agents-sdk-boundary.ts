import * as agentsSdk from "@openai/agents";
import type OpenAI from "openai";

// Keep the vendor SDK's serialized-state boundary independent of Vork's
// contracts. Runtime tests exercise the actual SDK, including serialize/resume.
export type SdkItem = Record<string, unknown>;
type FunctionCall = { type: "function_call"; name: string; arguments: string; callId: string };
type ApprovalItem = { rawItem: FunctionCall | { type: string } };
type SdkState = {
  toString(): string;
  getInterruptions(): ApprovalItem[];
  approve(item: ApprovalItem): void;
};
type SdkStream = AsyncIterable<{
  type: string;
  data?: { type: string; delta?: string };
}> & {
  state: SdkState;
  completed: Promise<void>;
  interruptions: ApprovalItem[];
  history: SdkItem[];
  finalOutput?: string;
};
type SdkModule = {
  Agent: new (options: { name: string; instructions: string; model: object; modelSettings: Record<string, unknown>; tools: object[] }) => object;
  OpenAIChatCompletionsModel: new (client: OpenAI, model: string) => object;
  Runner: new (options: { tracingDisabled: boolean }) => {
    run(agent: object, input: SdkState | SdkItem[], options: { stream: true; maxTurns: number; signal?: AbortSignal }): Promise<SdkStream>;
  };
  RunState: { fromString(agent: object, serialized: string): Promise<SdkState> };
  tool(options: {
    name: string; description: string; parameters: object; strict: false; errorFunction: null;
    needsApproval(context: unknown, args: unknown): Promise<boolean>;
    execute(args: unknown, context?: unknown, details?: { toolCall?: { callId: string } }): Promise<string>;
  }): object;
};

export const sdk = agentsSdk as unknown as SdkModule;
export function functionCall(item: ApprovalItem | undefined): FunctionCall | undefined {
  return item?.rawItem.type === "function_call" ? item.rawItem as FunctionCall : undefined;
}
