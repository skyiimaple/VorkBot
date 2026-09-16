import { AcquireSlotInputSchema, type AcquireSlotInput } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isComputerError, LeaseExpiredError, type LeaseManager } from "./lease-manager.js";

const LeaseIdBodySchema = z.object({
  leaseId: z.string().trim().min(1)
});

export type SlotRouteHooks = {
  onRelease?: (released: { slotId: string; kind: AcquireSlotInput["kind"] }) => Promise<void> | void;
};

export function registerSlotRoutes(
  app: FastifyInstance,
  manager: LeaseManager,
  hooks: SlotRouteHooks = {}
): void {
  app.post("/v1/slots/acquire", async (request, reply) => {
    const parsed = AcquireSlotInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    if (parsed.data.kind === "terminal") {
      return reply.code(501).send({ code: "not_implemented" });
    }

    const result = manager.acquire(parsed.data);
    if (isComputerError(result)) {
      return reply.code(503).send(result);
    }

    return reply.code(200).send(result);
  });

  app.post("/v1/slots/heartbeat", async (request, reply) => {
    const parsed = LeaseIdBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    const result = manager.heartbeat(parsed.data.leaseId);
    if (isComputerError(result)) {
      return reply.code(409).send(result);
    }

    try {
      return reply.code(200).send(manager.assertActive(parsed.data.leaseId));
    } catch (error) {
      if (error instanceof LeaseExpiredError) {
        return reply.code(409).send({ code: error.code });
      }
      throw error;
    }
  });

  app.post("/v1/slots/release", async (request, reply) => {
    const parsed = LeaseIdBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    const released = manager.release(parsed.data.leaseId);
    if (released) {
      await hooks.onRelease?.({ slotId: released.slotId, kind: released.kind });
    }
    return reply.code(204).send();
  });
}
