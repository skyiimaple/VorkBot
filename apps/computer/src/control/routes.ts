import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InvalidControlTransitionError, type ControlStateStore } from "./state.js";

const ControlActionSchema = z.object({
  action: z.enum(["takeover", "release"])
});

export function registerControlRoutes(app: FastifyInstance, store: ControlStateStore): void {
  app.get("/v1/slots/:slotId/control", async (request, reply) => {
    const slotId = z.string().trim().min(1).parse((request.params as { slotId: string }).slotId);
    return reply.code(200).send({ state: store.get(slotId) });
  });

  app.post("/v1/slots/:slotId/control", async (request, reply) => {
    const slotId = z.string().trim().min(1).parse((request.params as { slotId: string }).slotId);
    const parsed = ControlActionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      const state = store.apply(slotId, parsed.data.action);
      return reply.code(200).send({ state });
    } catch (error) {
      if (error instanceof InvalidControlTransitionError) {
        return reply.code(409).send({ code: error.code });
      }
      throw error;
    }
  });
}
