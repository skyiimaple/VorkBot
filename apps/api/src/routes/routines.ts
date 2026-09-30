import {
  CreateRoutineInputSchema,
  CreateRoutineResponseSchema,
  ListRoutineRunsInputSchema,
  ListRoutineRunsResponseSchema,
  ListRoutinesResponseSchema,
  RoutineResponseSchema,
  RunRoutineNowResponseSchema,
  UpdateRoutineInputSchema
} from "@vork/contracts";
import { RoutineActiveTaskError } from "@vork/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { publishRoutineDispatch, RoutinePublicationError } from "../services/routine-publication.js";

const IdParamsSchema = z.object({ id: z.string().trim().min(1) }).strict();
const EmptyBodySchema = z.object({}).strict();
const ErrorResponseSchema = z.object({ error: z.string().min(1) }).strict();

export function registerRoutineRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/routines", async (request) => {
    const routines = await dependencies.repositories.listRoutines(request.userId);
    return ListRoutinesResponseSchema.parse({ routines });
  });

  app.post("/v1/routines", async (request, reply) => {
    const input = CreateRoutineInputSchema.parse(request.body);
    try {
      const created = await dependencies.repositories.createRoutineWithConversation({
        userId: request.userId,
        ...input
      });
      return reply.code(201).send(CreateRoutineResponseSchema.parse({
        routine: created.routine,
        conversationId: created.conversation.id
      }));
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.get("/v1/routines/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const routine = await dependencies.repositories.getRoutine(id, request.userId);
    if (!routine) return reply.code(404).send({ error: "定时任务不存在" });
    return RoutineResponseSchema.parse({ routine });
  });

  app.put("/v1/routines/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = UpdateRoutineInputSchema.parse(request.body);
    try {
      const routine = await dependencies.repositories.updateRoutine(id, request.userId, input);
      return RoutineResponseSchema.parse({ routine });
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.delete("/v1/routines/:id", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    try {
      const routine = await dependencies.repositories.softDeleteRoutine(id, request.userId);
      return RoutineResponseSchema.parse({ routine });
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.post("/v1/routines/:id/enable", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    EmptyBodySchema.parse(request.body ?? {});
    try {
      const routine = await dependencies.repositories.setRoutineEnabled(id, request.userId, true);
      return RoutineResponseSchema.parse({ routine });
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.post("/v1/routines/:id/pause", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    EmptyBodySchema.parse(request.body ?? {});
    try {
      const routine = await dependencies.repositories.setRoutineEnabled(id, request.userId, false);
      return RoutineResponseSchema.parse({ routine });
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.post("/v1/routines/:id/run-now", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    EmptyBodySchema.parse(request.body ?? {});
    try {
      const dispatch = await dependencies.repositories.runRoutineNow(id, request.userId);
      await publishRoutineDispatch(dispatch, dependencies.queue, dependencies.repositories);
      return RunRoutineNowResponseSchema.parse({ run: dispatch.run, taskId: dispatch.taskJob?.taskId ?? null });
    } catch (error) {
      return mapRoutineError(error, reply);
    }
  });

  app.get("/v1/routines/:id/runs", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const rawQuery = z.object({ cursor: z.string().optional(), limit: z.string().optional() }).parse(request.query ?? {});
    const query = ListRoutineRunsInputSchema.parse({
      cursor: rawQuery.cursor,
      limit: rawQuery.limit === undefined ? undefined : Number(rawQuery.limit)
    });
    const routine = await dependencies.repositories.getRoutine(id, request.userId);
    if (!routine) return reply.code(404).send({ error: "定时任务不存在" });
    try {
      const page = await dependencies.repositories.listRoutineRunsPage(id, request.userId, query);
      return ListRoutineRunsResponseSchema.parse(page);
    } catch (error) {
      if (errorMessage(error) === "ROUTINE_RUN_CURSOR_INVALID") {
        return reply.code(400).send({ error: "无效的分页游标" });
      }
      throw error;
    }
  });
}

function mapRoutineError(error: unknown, reply: FastifyReply) {
  if (error instanceof RoutineActiveTaskError || errorMessage(error) === "ROUTINE_VERSION_CONFLICT") {
    return reply.code(409).send(ErrorResponseSchema.parse({ error: "定时任务存在冲突" }));
  }
  if (error instanceof RoutinePublicationError || errorMessage(error) === "ROUTINE_PUBLICATION_FAILED") {
    return reply.code(500).send(ErrorResponseSchema.parse({ error: "定时任务入队失败" }));
  }
  if (["ROUTINE_NOT_FOUND", "ROUTINE_BOT_NOT_FOUND"].includes(errorMessage(error))) {
    return reply.code(404).send(ErrorResponseSchema.parse({ error: "定时任务不存在" }));
  }
  if (errorMessage(error).startsWith("ROUTINE_")) {
    return reply.code(400).send(ErrorResponseSchema.parse({ error: "无效的定时设置" }));
  }
  throw error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
