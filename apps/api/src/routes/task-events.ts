import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { TaskEventStream } from "../services/event-stream.js";

const TaskParamsSchema = z.object({ id: z.string().trim().min(1) });
const TaskEventsQuerySchema = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export function registerTaskEventRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies & { eventSubscriber: NonNullable<ApiDependencies["eventSubscriber"]> }
): void {
  app.get("/v1/tasks/:id/events", async (request, reply) => {
    const { id: taskId } = TaskParamsSchema.parse(request.params);
    const { after } = TaskEventsQuerySchema.parse(request.query);
    const task = await dependencies.repositories.getTask(taskId);
    if (!task || task.userId !== request.userId) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Task not found" }));
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no"
    });
    const stream = new TaskEventStream(dependencies.repositories, dependencies.eventSubscriber, reply.raw, taskId, after);
    const close = () => void stream.close();
    reply.raw.once("close", close);
    try {
      await stream.open();
    } catch {
      await stream.close();
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}
