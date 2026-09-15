import Fastify, { type FastifyInstance } from "fastify";
import type { Repositories } from "@vork/database";
import { ZodError, z } from "zod";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerBotRoutes } from "./routes/bots.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import type { TaskQueue } from "./services/chat-service.js";

const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export type ApiDependencies = {
  repositories: Repositories;
  queue: TaskQueue;
  userId?: string;
};

export function buildApp(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify();
  registerRequestContext(app, dependencies.userId);
  registerBotRoutes(app, dependencies);
  registerConversationRoutes(app, dependencies);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send(ErrorResponseSchema.parse({ error: "Invalid request" }));
    }
    return reply.code(500).send(ErrorResponseSchema.parse({ error: "Internal server error" }));
  });
  return app;
}
