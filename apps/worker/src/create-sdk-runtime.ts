import { AgentsSdkRuntime } from "./agents-sdk-runtime.js";
import { normalizeOpenAICompatibleBaseUrl } from "./openai-compatible-model.js";

type Credential = { apiKey: string; baseUrl: string | null; model: string | null };
export function resolveSdkModelConfig(environment: NodeJS.ProcessEnv, credential?: Credential | null) {
  if (environment.VORK_MODEL_PROVIDER?.trim() === "fake") return undefined;
  const apiKey = credential?.apiKey.trim() || environment.LLM_API_KEY?.trim();
  if (!apiKey) return undefined;
  const baseURL = normalizeOpenAICompatibleBaseUrl(credential?.baseUrl?.trim() || environment.LLM_BASE_URL?.trim() || "https://api.deepseek.com");
  const model = credential?.model?.trim() || environment.LLM_MODEL?.trim() || "deepseek-v4-flash";
  const timeoutMs = Number(environment.LLM_TIMEOUT_MS?.trim() || 60_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("LLM_TIMEOUT_MS must be a positive number");
  return { apiKey, baseURL, model, timeoutMs };
}

export function createSdkRuntimeFromConfig(environment: NodeJS.ProcessEnv, credential?: Credential | null) {
  const config = resolveSdkModelConfig(environment, credential);
  return config ? new AgentsSdkRuntime(config) : undefined;
}
