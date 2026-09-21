import { FakeModel } from "./fake-model.js";
import type { ModelProvider } from "./model.js";
import { OpenAICompatibleModel, normalizeOpenAICompatibleBaseUrl } from "./openai-compatible-model.js";

const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
const DEFAULT_LLM_MODEL = "deepseek-v4-flash";

export type CreateModelFromEnvOptions = {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

/**
 * 从环境变量创建出站模型。
 *
 * - 有 `LLM_API_KEY`：OpenAI-compatible（DeepSeek 等），读 `LLM_BASE_URL` / `LLM_MODEL`
 * - 无 key：回退 FakeModel（本地/CI 默认可跑）
 * - `VORK_MODEL_PROVIDER=fake`：强制 FakeModel（即便有 key，便于冒烟对照）
 */
export function createModelFromEnv(options: CreateModelFromEnvOptions = {}): ModelProvider {
  const env = options.environment ?? process.env;
  const forceFake = env.VORK_MODEL_PROVIDER?.trim() === "fake";
  const apiKey = env.LLM_API_KEY?.trim();

  if (forceFake || !apiKey) {
    return new FakeModel({ chunks: ["你好，", "我是 Vork。"], delayMs: 40 });
  }

  const baseUrl = normalizeOpenAICompatibleBaseUrl(env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL);
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  const timeoutRaw = env.LLM_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined;
  if (timeoutRaw && (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0)) {
    throw new Error("LLM_TIMEOUT_MS must be a positive integer");
  }

  return new OpenAICompatibleModel({
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    fetchImpl: options.fetchImpl
  });
}
