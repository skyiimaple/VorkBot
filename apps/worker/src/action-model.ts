import { AgentActionSchema, type AgentAction } from "@vork/contracts";
import type { ActionModel, ActionModelContext } from "./fake-action-model.js";
import { createAgentFileDemoActions, FakeActionModel } from "./fake-action-model.js";
import { normalizeOpenAICompatibleBaseUrl } from "./openai-compatible-model.js";

const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";

const AGENT_LLM_MARKER = "[agent-llm]";

/** 需要真模型（或 key 缺失时 Fake）驱动的 Agent 循环入口标记 */
export function isAgentLlmMessage(content: string): boolean {
  return content.includes(AGENT_LLM_MARKER);
}

const ACTION_SYSTEM_PROMPT = [
  "你是 Vork 受控 Agent。每轮只能输出**一个** JSON 对象，不要 Markdown 代码围栏，不要解释文字。",
  "type 必须是以下之一：",
  '- {"type":"file.write","path":"相对路径","content":"文本"}',
  '- {"type":"file.read","path":"相对路径"}',
  '- {"type":"message.reply","text":"给用户的回复"}',
  '- {"type":"task.complete"}',
  '- {"type":"task.fail","errorCode":"CODE","message":"可选说明"}',
  "路径相对 Bot 工作区，禁止 .. 与绝对路径。",
  "完成任务前应先 message.reply 摘要，再 task.complete；工具结果会作为「上一观察」回传。"
].join("\n");

export type OpenAICompatibleActionModelOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Bot persona 等附加系统提示 */
  systemPrompt?: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
};

/**
 * 从模型文本中解析单一 AgentAction。
 * 支持裸 JSON 或 ```json ... ``` 围栏；解析/校验失败 → task.fail(INVALID_AGENT_ACTION)。
 */
export function parseAgentActionFromModelOutput(raw: string): AgentAction {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: "task.fail", errorCode: "INVALID_AGENT_ACTION", message: "empty model output" };
  }

  const candidates = [trimmed, extractFencedJson(trimmed), extractFirstJsonObject(trimmed)].filter(
    (value): value is string => Boolean(value)
  );

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = AgentActionSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // try next candidate
    }
  }

  return {
    type: "task.fail",
    errorCode: "INVALID_AGENT_ACTION",
    message: trimmed.slice(0, 200)
  };
}

function extractFencedJson(text: string): string | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

export class OpenAICompatibleActionModel implements ActionModel {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly systemPrompt: string;

  constructor(options: OpenAICompatibleActionModelOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeOpenAICompatibleBaseUrl(options.baseUrl);
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.systemPrompt = [ACTION_SYSTEM_PROMPT, options.systemPrompt?.trim()].filter(Boolean).join("\n\n");
  }

  async nextAction(ctx: ActionModelContext): Promise<AgentAction> {
    const userContent = [
      `用户目标：${ctx.userMessage}`,
      `当前轮次：${ctx.turn}`,
      `上一观察：${ctx.lastObservation?.trim() || "无"}`,
      "请只输出下一个动作的 JSON。"
    ].join("\n");

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        type: "task.fail",
        errorCode: "MODEL_UNAVAILABLE",
        message: `openai-compatible http ${response.status}${detail ? `: ${detail}` : ""}`
      };
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch {
      return { type: "task.fail", errorCode: "INVALID_AGENT_ACTION", message: "response is not json" };
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return { type: "task.fail", errorCode: "INVALID_AGENT_ACTION", message: "missing message content" };
    }

    return parseAgentActionFromModelOutput(content);
  }
}

export type CreateActionModelFromEnvOptions = {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  systemPrompt?: string;
};

/**
 * - 有 `LLM_API_KEY` 且未强制 fake → OpenAICompatibleActionModel
 * - 否则 → FakeActionModel（与 [agent-file] 相同的确定性文件剧本，便于无 key 本地跑）
 */
export function createActionModelFromEnv(options: CreateActionModelFromEnvOptions = {}): ActionModel {
  const env = options.environment ?? process.env;
  const forceFake = env.VORK_MODEL_PROVIDER?.trim() === "fake";
  const apiKey = env.LLM_API_KEY?.trim();

  if (forceFake || !apiKey) {
    return new FakeActionModel(createAgentFileDemoActions());
  }

  const timeoutRaw = env.LLM_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined;
  if (timeoutRaw && (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0)) {
    throw new Error("LLM_TIMEOUT_MS must be a positive integer");
  }

  return new OpenAICompatibleActionModel({
    apiKey,
    baseUrl: env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL,
    model: env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
    timeoutMs,
    fetchImpl: options.fetchImpl,
    systemPrompt: options.systemPrompt
  });
}
