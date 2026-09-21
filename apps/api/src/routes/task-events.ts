import { TaskSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { TaskEventStream } from "../services/event-stream.js";

const TaskParamsSchema = z.object({ id: z.string().trim().min(1) });
const TaskEventsQuerySchema = z.object({ after: z.coerce.number().int().nonnegative().default(0) });
const ErrorResponseSchema = z.object({ error: z.string().min(1) });
const CancelTaskResponseSchema = z.object({ task: TaskSchema });

export function registerTaskEventRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies & { eventSubscriber: NonNullable<ApiDependencies["eventSubscriber"]> }
): void {
  app.get("/v1/tasks/:id/events", async (request, reply) => {
    const { id: taskId } = TaskParamsSchema.parse(request.params);
    const { after } = TaskEventsQuerySchema.parse(request.query);
    const task = await dependencies.repositories.getTask(taskId);
    if (!task || task.userId !== request.userId) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "任务不存在" }));
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

  app.post("/v1/tasks/:id/cancel", async (request, reply) => {
    const { id: taskId } = TaskParamsSchema.parse(request.params);
    const task = await dependencies.repositories.getTask(taskId);
    if (!task || task.userId !== request.userId) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "任务不存在" }));
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return reply.code(409).send(ErrorResponseSchema.parse({ error: "任务已结束，无法取消" }));
    }

    try {
      const cancelled = TaskSchema.parse(await dependencies.repositories.cancelTask(taskId));
      try {
        await dependencies.taskEventPublisher?.publish(taskId);
      } catch {
        // 持久化事件仍可在重连时按 after 游标对齐。
      }
      return CancelTaskResponseSchema.parse({ task: cancelled });
    } catch {
      return reply.code(409).send(ErrorResponseSchema.parse({ error: "任务已结束，无法取消" }));
    }
  });
}
