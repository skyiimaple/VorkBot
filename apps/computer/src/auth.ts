import type { FastifyInstance } from "fastify";

export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/health?")) {
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${token}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
