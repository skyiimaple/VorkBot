import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";

const SlotParamsSchema = z.object({
  slotId: z.string().trim().min(1)
});

const FrameQuerySchema = z.object({
  taskId: z.string().trim().min(1)
});

const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export type ComputerProxyOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
};

function extractLeaseId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const leaseId = (payload as { leaseId?: unknown }).leaseId;
  return typeof leaseId === "string" && leaseId.length > 0 ? leaseId : undefined;
}

function extractSlotId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const slotId = (payload as { slotId?: unknown }).slotId;
  return typeof slotId === "string" && slotId.length > 0 ? slotId : undefined;
}

export function registerComputerRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies,
  computer: ComputerProxyOptions
): void {
  const fetchImpl = computer.fetch ?? fetch;

  app.get("/v1/computer/slots/:slotId/frame", async (request, reply) => {
    const { slotId } = SlotParamsSchema.parse(request.params);
    const { taskId } = FrameQuerySchema.parse(request.query);

    const task = await dependencies.repositories.getTask(taskId);
    if (!task || task.userId !== request.userId) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Task not found" }));
    }

    const events = await dependencies.repositories.listTaskEvents(taskId, 0);
    const acquired = [...events].reverse().find((event) => {
      if (event.type !== "slot.acquired") return false;
      return extractSlotId(event.payload) === slotId;
    });
    const leaseId = extractLeaseId(acquired?.payload);
    if (!leaseId) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Slot lease not found" }));
    }

    const upstream = await fetchImpl(
      new URL(`/v1/slots/${encodeURIComponent(slotId)}/frame?leaseId=${encodeURIComponent(leaseId)}`, computer.baseUrl),
      {
        headers: {
          authorization: `Bearer ${computer.token}`,
          accept: "image/jpeg"
        }
      }
    );

    if (upstream.status === 404 || upstream.status === 409) {
      return reply.code(upstream.status).send(ErrorResponseSchema.parse({ error: "Frame unavailable" }));
    }
    if (!upstream.ok) {
      return reply.code(502).send(ErrorResponseSchema.parse({ error: "Computer unavailable" }));
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    return reply
      .code(200)
      .header("content-type", "image/jpeg")
      .header("cache-control", "no-store")
      .send(bytes);
  });
}
