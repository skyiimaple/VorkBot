import { BotSchema, ConversationSchema, CreateBotInputSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";

const ListBotsResponseSchema = z.object({ bots: z.array(BotSchema) });
const CreateBotResponseSchema = z.object({ bot: BotSchema, conversation: ConversationSchema });

export function registerBotRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/bots", async (request) => {
    const bots = await dependencies.repositories.listBots(request.userId);
    return ListBotsResponseSchema.parse({ bots });
  });

  app.post("/v1/bots", async (request, reply) => {
    const input = CreateBotInputSchema.parse(request.body);
    const bot = BotSchema.parse(await dependencies.repositories.createBot({ userId: request.userId, ...input }));
    const conversation = ConversationSchema.parse(
      await dependencies.repositories.createConversation({ userId: request.userId, botId: bot.id })
    );
    return reply.code(201).send(CreateBotResponseSchema.parse({ bot, conversation }));
  });
}
