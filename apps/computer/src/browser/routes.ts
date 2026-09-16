import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeaseExpiredError } from "../slots/lease-manager.js";
import {
  BrowserKindError,
  BrowserService,
  StaleElementRefError,
  isBrowserServiceError
} from "./service.js";

const LeaseIdBodySchema = z.object({
  leaseId: z.string().trim().min(1)
});

const NavigateBodySchema = LeaseIdBodySchema.extend({
  url: z.string().trim().min(1)
});

const RefBodySchema = LeaseIdBodySchema.extend({
  ref: z.string().trim().min(1)
});

const TypeBodySchema = RefBodySchema.extend({
  text: z.string()
});

const ScrollBodySchema = LeaseIdBodySchema.extend({
  deltaY: z.number().optional()
});

function sendBrowserError(
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown
): unknown {
  if (error instanceof LeaseExpiredError) {
    return reply.code(409).send({ code: error.code });
  }
  if (error instanceof BrowserKindError) {
    return reply.code(400).send({ code: error.code });
  }
  if (error instanceof StaleElementRefError) {
    return reply.code(409).send({ code: error.code });
  }
  throw error;
}

export function registerBrowserRoutes(app: FastifyInstance, service: BrowserService): void {
  app.post("/v1/browser/observe", async (request, reply) => {
    const parsed = LeaseIdBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.observe(parsed.data));
    } catch (error) {
      if (isBrowserServiceError(error)) {
        return sendBrowserError(reply, error);
      }
      throw error;
    }
  });

  app.post("/v1/browser/navigate", async (request, reply) => {
    const parsed = NavigateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.navigate(parsed.data));
    } catch (error) {
      if (isBrowserServiceError(error)) {
        return sendBrowserError(reply, error);
      }
      throw error;
    }
  });

  app.post("/v1/browser/click", async (request, reply) => {
    const parsed = RefBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.click(parsed.data));
    } catch (error) {
      if (isBrowserServiceError(error)) {
        return sendBrowserError(reply, error);
      }
      throw error;
    }
  });

  app.post("/v1/browser/type", async (request, reply) => {
    const parsed = TypeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.type(parsed.data));
    } catch (error) {
      if (isBrowserServiceError(error)) {
        return sendBrowserError(reply, error);
      }
      throw error;
    }
  });

  app.post("/v1/browser/scroll", async (request, reply) => {
    const parsed = ScrollBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.scroll(parsed.data));
    } catch (error) {
      if (isBrowserServiceError(error)) {
        return sendBrowserError(reply, error);
      }
      throw error;
    }
  });
}
