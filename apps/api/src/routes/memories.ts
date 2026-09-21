import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";

const BotParamsSchema = z.object({ id: z.string().trim().min(1) });

export function registerMemoryRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/bots/:id/memories", async (request, reply) => {
    const { id: botId } = BotParamsSchema.parse(request.params);
    const bot = await dependencies.repositories.getBot({ userId: request.userId, botId });
    if (!bot) return reply.code(404).send({ error: "Bot 不存在" });
    const memories = await dependencies.repositories.listMemories({ userId: request.userId, botId });
    return { memories };
  });
}
