import {
  ActiveTaskResponseSchema,
  PauseTaskInputSchema,
  ResumeTaskInputSchema,
  TaskControlStateSchema,
  TaskSchema,
  UncertainResolutionInputSchema
} from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { publishRecoverableTask } from "../services/task-publication.js";

const IdParamsSchema = z.object({ id: z.string().trim().min(1) });
const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export function registerTaskControlRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.post("/v1/tasks/:id/pause", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    PauseTaskInputSchema.parse(request.body ?? {});
    const owned = await dependencies.repositories.getTask(id);
    if (!owned || owned.userId !== request.userId) return reply.code(404).send({ error: "任务不存在" });
    try {
      const task = TaskSchema.parse(await dependencies.repositories.requestTaskPause(id, request.userId));
      await publishEvent(dependencies, id);
      return { task };
    } catch {
      return reply.code(409).send(ErrorResponseSchema.parse({ error: "当前状态无法暂停" }));
    }
  });

  app.post("/v1/tasks/:id/resume", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    ResumeTaskInputSchema.parse(request.body ?? {});
    const owned = await dependencies.repositories.getTask(id);
    if (!owned || owned.userId !== request.userId) return reply.code(404).send({ error: "任务不存在" });
    let task;
    try {
      task = TaskSchema.parse(await dependencies.repositories.resumeTask(id, request.userId));
    } catch {
      return reply.code(409).send(ErrorResponseSchema.parse({ error: "当前状态无法恢复" }));
    }
    try {
      await publishRecoverableTask(task, dependencies.queue, dependencies.repositories);
    } catch {
      await publishEvent(dependencies, id);
      return reply.code(500).send(ErrorResponseSchema.parse({ error: "任务恢复入队失败" }));
    }
    await publishEvent(dependencies, id);
    return { task };
  });

  app.get("/v1/tasks/:id/control-state", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const controlState = await dependencies.repositories.getTaskControlState(id, request.userId);
    if (!controlState) return reply.code(404).send({ error: "任务不存在" });
    return TaskControlStateSchema.parse(controlState);
  });

  app.post("/v1/tasks/:id/uncertain-resolution", async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const input = UncertainResolutionInputSchema.parse(request.body);
    const owned = await dependencies.repositories.getTask(id);
    if (!owned || owned.userId !== request.userId) return reply.code(404).send({ error: "任务不存在" });
    try {
      const task = TaskSchema.parse(
        await dependencies.repositories.resolveUncertainToolCall(id, request.userId, input.resolution)
      );
      if (task.status === "queued") await publishRecoverableTask(task, dependencies.queue, dependencies.repositories);
      await publishEvent(dependencies, id);
      return { task };
    } catch (error) {
      if (error instanceof Error && error.message === "TASK_PUBLICATION_FAILED") {
        return reply.code(500).send({ error: "任务恢复入队失败" });
      }
      return reply.code(409).send({ error: "无法处理不确定结果" });
    }
  });

  app.get("/v1/conversations/:id/active-task", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const tasks = await dependencies.repositories.listTasks(request.userId, 100);
    const active = tasks.find(
      ({ task }) => task.conversationId === id && !["completed", "failed", "cancelled"].includes(task.status)
    );
    if (!active) return ActiveTaskResponseSchema.parse({ controlState: null });
    const controlState = await dependencies.repositories.getTaskControlState(active.task.id, request.userId);
    return ActiveTaskResponseSchema.parse({ controlState });
  });
}

async function publishEvent(dependencies: ApiDependencies, taskId: string): Promise<void> {
  try {
    await dependencies.taskEventPublisher?.publish(taskId);
  } catch {
    // 持久化事件可在重连时按游标恢复。
  }
}
