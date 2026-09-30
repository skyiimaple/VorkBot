import {
  TerminalReadInputSchema,
  TerminalStartInputSchema,
  TerminalTerminateInputSchema,
  TerminalWriteInputSchema
} from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { LeaseExpiredError } from "../slots/lease-manager.js";
import { TerminalNotRunningError } from "./session.js";
import { TerminalLeaseKindError, TerminalService, TerminalSessionNotFoundError } from "./service.js";

function sendTerminalError(
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown
): unknown {
  if (error instanceof LeaseExpiredError) return reply.code(409).send({ code: error.code });
  if (error instanceof TerminalLeaseKindError) return reply.code(400).send({ code: error.code });
  if (error instanceof TerminalSessionNotFoundError) return reply.code(404).send({ code: error.code });
  if (error instanceof TerminalNotRunningError) return reply.code(409).send({ code: error.code });
  throw error;
}

export function registerTerminalRoutes(app: FastifyInstance, service: TerminalService): void {
  app.post("/v1/terminal/start", async (request, reply) => {
    const parsed = TerminalStartInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    try {
      return reply.code(200).send(await service.start(parsed.data));
    } catch (error) {
      return sendTerminalError(reply, error);
    }
  });

  app.post("/v1/terminal/write", async (request, reply) => {
    const parsed = TerminalWriteInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    try {
      return reply.code(200).send(await service.write(parsed.data));
    } catch (error) {
      return sendTerminalError(reply, error);
    }
  });

  app.post("/v1/terminal/read", async (request, reply) => {
    const parsed = TerminalReadInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    try {
      return reply.code(200).send(await service.read(parsed.data));
    } catch (error) {
      return sendTerminalError(reply, error);
    }
  });

  app.post("/v1/terminal/terminate", async (request, reply) => {
    const parsed = TerminalTerminateInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    try {
      return reply.code(200).send(await service.terminate(parsed.data));
    } catch (error) {
      return sendTerminalError(reply, error);
    }
  });
}
