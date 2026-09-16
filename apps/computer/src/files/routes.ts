import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LeaseExpiredError } from "../slots/lease-manager.js";
import { PathTraversalError } from "./path-sandbox.js";
import {
  FileNotFoundError,
  FileService,
  FileTooLargeError,
  ReadOnlyRootError,
  WriteQuotaExceededError
} from "./service.js";

const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((path) => !path.startsWith("/"), { message: "Path must be relative" })
  .refine((path) => !path.split(/[/\\]/).some((segment) => segment === ".."), {
    message: "Path traversal is not allowed"
  });

const OptionalRelativePathSchema = z
  .string()
  .trim()
  .refine((path) => path.length === 0 || !path.startsWith("/"), {
    message: "Path must be relative"
  })
  .refine((path) => !path.split(/[/\\]/).some((segment) => segment === ".."), {
    message: "Path traversal is not allowed"
  });

const FileRootSchema = z.enum(["bot", "shared"]);

const LeaseIdSchema = z.object({
  leaseId: z.string().trim().min(1)
});

const ListBodySchema = LeaseIdSchema.extend({
  path: OptionalRelativePathSchema.optional(),
  root: FileRootSchema.optional()
});

const PathBodySchema = LeaseIdSchema.extend({
  path: RelativePathSchema,
  root: FileRootSchema.optional()
});

const ReadBodySchema = PathBodySchema.extend({
  encoding: z.enum(["utf8", "base64"]).optional()
});

const WriteBodySchema = PathBodySchema.extend({
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).optional()
});

function sendServiceError(
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown
): unknown {
  if (error instanceof LeaseExpiredError) {
    return reply.code(409).send({ code: error.code });
  }
  if (error instanceof ReadOnlyRootError) {
    return reply.code(403).send({ code: error.code });
  }
  if (error instanceof FileTooLargeError || error instanceof WriteQuotaExceededError) {
    return reply.code(413).send({ code: error.code });
  }
  if (error instanceof FileNotFoundError) {
    return reply.code(404).send({ code: error.code });
  }
  if (error instanceof PathTraversalError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

export function registerFileRoutes(app: FastifyInstance, service: FileService): void {
  app.post("/v1/files/list", async (request, reply) => {
    const parsed = ListBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.list(parsed.data));
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/v1/files/stat", async (request, reply) => {
    const parsed = PathBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.stat(parsed.data));
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/v1/files/read", async (request, reply) => {
    const parsed = ReadBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.read(parsed.data));
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/v1/files/write", async (request, reply) => {
    const parsed = WriteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.write(parsed.data));
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/v1/files/mkdir", async (request, reply) => {
    const parsed = PathBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "bad_request", message: parsed.error.message });
    }

    try {
      return reply.code(200).send(await service.mkdir(parsed.data));
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });
}
