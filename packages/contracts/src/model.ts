import { z } from "zod";

/** Worker / 管理页共用的模型供应商种类（阶段 3 首批） */
export const ModelProviderKindSchema = z.enum(["fake", "openai-compatible"]);

/**
 * 可序列化的模型运行时配置（不含 API Key）。
 * 管理页 stub 可复用；密钥经环境变量 `LLM_API_KEY`（或后续凭据写入接口）传递，勿写入事件/日志。
 *
 * Worker 环境变量约定（DeepSeek / OpenAI-compatible）：
 * - `LLM_API_KEY`：有值则走真实供应商，空则 FakeModel
 * - `LLM_BASE_URL`：如 `https://api.deepseek.com`（缺 `/v1` 时 Worker 自动补全）
 * - `LLM_MODEL`：如 `deepseek-v4-flash`
 */
export const ModelRuntimeConfigSchema = z.object({
  provider: ModelProviderKindSchema,
  baseUrl: z.string().url().optional(),
  model: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional()
});

/** 写入凭据时的请求体形状（apiKey 只写不读；管理页 stub 可复用） */
export const ModelCredentialWriteSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().url().optional(),
  model: z.string().trim().min(1).optional()
});

export type ModelProviderKind = z.infer<typeof ModelProviderKindSchema>;
export type ModelRuntimeConfig = z.infer<typeof ModelRuntimeConfigSchema>;
export type ModelCredentialWrite = z.infer<typeof ModelCredentialWriteSchema>;
