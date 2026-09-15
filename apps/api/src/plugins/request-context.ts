import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const UserIdSchema = z.string().min(1);

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export function registerRequestContext(app: FastifyInstance, userId = "user_local"): void {
  const validatedUserId = UserIdSchema.parse(userId);
  app.decorateRequest("userId", "");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.userId = validatedUserId;
  });
}
