import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeaseExpiredError, type LeaseManager } from "../slots/lease-manager.js";
import type { BrowserSessionRegistry } from "../browser/session.js";

const FrameQuerySchema = z.object({
  leaseId: z.string().trim().min(1)
});

export function registerFrameRoutes(
  app: FastifyInstance,
  options: { leaseManager: LeaseManager; sessions: BrowserSessionRegistry }
): void {
  app.get("/v1/slots/:slotId/frame", async (request, reply) => {
    const slotId = z.string().trim().min(1).parse((request.params as { slotId: string }).slotId);
    const parsed = FrameQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      const lease = options.leaseManager.assertActive(parsed.data.leaseId);
      if (lease.slotId !== slotId) {
        return reply.code(404).send({ code: "slot_not_found" });
      }

      const session = options.sessions.get(slotId);
      if (!session) {
        return reply.code(404).send({ code: "browser_unavailable" });
      }

      const frame = await session.captureFrame();
      return reply
        .code(200)
        .header("content-type", "image/jpeg")
        .header("cache-control", "no-store")
        .send(frame);
    } catch (error) {
      if (error instanceof LeaseExpiredError) {
        return reply.code(409).send({ code: error.code });
      }
      throw error;
    }
  });
}
