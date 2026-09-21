import { ListModelCredentialsResponseSchema, ModelCredentialWriteSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "../app.js";
import { stubModelCredentials } from "../services/manage-stubs.js";

function maskSecret(secret: string): string {
  return `****${secret.slice(-4)}`;
}

async function presentCredentials(dependencies: ApiDependencies, userId: string) {
  const stored = await dependencies.repositories.getModelCredential(userId);
  if (!stored) return ListModelCredentialsResponseSchema.parse(stubModelCredentials());
  const masked = maskSecret(stored.apiKey);
  return ListModelCredentialsResponseSchema.parse({
    source: "database",
    currentMode: {
      id: "mode_remote",
      label: "当前模式",
      description: `已配置 ${stored.provider}（${stored.model ?? "默认模型"}）。密钥仅保存，接口不回读明文。`
    },
    credentials: [
      {
        id: "credential_openai_compatible",
        provider: stored.provider,
        label: stored.provider,
        status: "enabled",
        statusLabel: "启用",
        mode: "remote",
        modeLabel: "远程",
        configured: true,
        summary: `密钥 ${masked}${stored.baseUrl ? ` · ${stored.baseUrl}` : ""}`
      }
    ]
  });
}

export function registerCredentialRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/credentials", async (request) => presentCredentials(dependencies, request.userId));

  app.put("/v1/credentials", async (request) => {
    const body = ModelCredentialWriteSchema.parse(request.body);
    await dependencies.repositories.upsertModelCredential({
      userId: request.userId,
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model
    });
    return presentCredentials(dependencies, request.userId);
  });
}
