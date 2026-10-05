import OpenAI from "openai";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import type { AgentToolAction } from "@vork/contracts";
import {
  AGENTS_COMPUTER_TOOL_DEFINITIONS,
  parseAgentsComputerToolCall
} from "./agents-computer-tools.js";

export class OpenAIAgentRuntimeError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "OpenAIAgentRuntimeError";
  }
}

export type OpenAIAgentsTurnInput = {
  sessionId?: string;
  input: string;
  instructions: string;
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
  onDelta: (delta: string) => void | Promise<void>;
  onToolCall?: (action: AgentToolAction) => string | Promise<string>;
};

export type OpenAIAgentsTurnResult = {
  sessionId: string;
  reply: string;
};

export async function consumeAgentEvents(
  events: AsyncIterable<AgentSessionEvent>,
  knownSessionId: string | undefined,
  onDelta: (delta: string) => void | Promise<void>,
  options?: {
    onSessionCreated?: (sessionId: string) => void | Promise<void>;
    onToolCall?: (action: AgentToolAction) => string | Promise<string>;
    submitToolResults?: (sessionId: string, events: Array<Record<string, unknown>>) => Promise<void>;
  }
): Promise<OpenAIAgentsTurnResult> {
  let sessionId = knownSessionId;
  let completed = false;
  let reply = "";
  const finalAnswerItems = new Set<string>();

  for await (const event of events) {
    if (event.type === "agent.session.created") {
      sessionId = event.session.id ?? undefined;
      if (sessionId) await options?.onSessionCreated?.(sessionId);
      continue;
    }
    if (event.type === "agent.session.turn.item.added") {
      if (event.item.type === "message" && event.item.id && event.item.role === "assistant" && event.item.phase === "final_answer") {
        finalAnswerItems.add(event.item.id);
      }
      continue;
    }
    if (event.type === "agent.session.turn.output_text.delta") {
      if (!finalAnswerItems.has(event.item_id)) continue;
      reply += event.delta;
      await onDelta(event.delta);
      continue;
    }
    if (event.type === "agent.session.requires_action" && options?.onToolCall && options.submitToolResults) {
      const results: Array<Record<string, unknown>> = [];
      for (const action of event.session.required_actions) {
        if (action.type !== "function_call") continue;
        try {
          const parsedArguments: unknown = typeof action.arguments === "string"
            ? JSON.parse(action.arguments)
            : action.arguments;
          if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
            throw new Error("INVALID_AGENTS_TOOL_ARGUMENTS");
          }
          const arguments_ = parsedArguments as Record<string, unknown>;
          const output = await options.onToolCall(parseAgentsComputerToolCall(action.name, arguments_));
          results.push({
            type: "agent.session.input.tool_result",
            turn_id: action.turn_id,
            call_id: action.call_id,
            success: true,
            output
          });
        } catch {
          results.push({
            type: "agent.session.input.tool_result",
            turn_id: action.turn_id,
            call_id: action.call_id,
            success: false,
            error: "Tool handler failed."
          });
        }
      }
      if (results.length > 0) {
        const resultSessionId = sessionId ?? event.session.id;
        if (!resultSessionId) throw new OpenAIAgentRuntimeError("OPENAI_AGENT_SESSION_MISSING");
        await options.submitToolResults(resultSessionId, results);
      }
      continue;
    }
    if (event.type === "agent.session.turn.completed") {
      completed = true;
      continue;
    }
    if (event.type === "agent.session.turn.failed" || event.type === "agent.session.failed") {
      throw new OpenAIAgentRuntimeError("OPENAI_AGENT_TURN_FAILED");
    }
    if (event.type === "agent.session.turn.cancelled") {
      throw new OpenAIAgentRuntimeError("OPENAI_AGENT_TURN_CANCELLED");
    }
  }

  if (!sessionId) throw new OpenAIAgentRuntimeError("OPENAI_AGENT_SESSION_MISSING");
  if (!completed) throw new OpenAIAgentRuntimeError("OPENAI_AGENT_STREAM_INTERRUPTED");
  if (!reply.trim()) throw new OpenAIAgentRuntimeError("OPENAI_AGENT_EMPTY_REPLY");
  return { sessionId, reply };
}

export class OpenAIAgentsRuntime {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: {
    model: string;
    apiKey?: string;
    baseURL?: string;
    client?: OpenAI;
  }) {
    this.model = options.model;
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  async runTurn(input: OpenAIAgentsTurnInput): Promise<OpenAIAgentsTurnResult> {
    if (input.sessionId) {
      const toolHandlers = Object.fromEntries(AGENTS_COMPUTER_TOOL_DEFINITIONS.map((tool) => [
        tool.name,
        async (arguments_: Record<string, unknown>) => {
          if (!input.onToolCall) throw new Error("COMPUTER_UNAVAILABLE");
          return input.onToolCall(parseAgentsComputerToolCall(tool.name, arguments_));
        }
      ]));
      const eventStream = this.client.beta.agents.sessions.stream(input.sessionId, {
        input: input.input,
        toolHandlers: input.onToolCall ? toolHandlers : {}
      });
      return consumeAgentEvents(eventStream, input.sessionId, input.onDelta);
    }

    const eventStream = await this.client.beta.agents.sessions.create({
      agent: {
        model: this.model,
        instructions: input.instructions,
        tools: [
          { type: "web_search", mode: "live" },
          ...AGENTS_COMPUTER_TOOL_DEFINITIONS
        ]
      },
      environment: { type: "none" },
      input: input.input,
      stream: true
    });
    return consumeAgentEvents(eventStream, undefined, input.onDelta, {
      onSessionCreated: input.onSessionCreated,
      onToolCall: input.onToolCall,
      submitToolResults: async (sessionId, events) => {
        await this.client.beta.agents.sessions.events.create(sessionId, { events } as never);
      }
    });
  }
}
