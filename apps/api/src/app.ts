import Fastify, { type FastifyInstance } from "fastify";
import type { Repositories } from "@vork/database";
import { ZodError, z } from "zod";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerBotRoutes } from "./routes/bots.js";
import { registerComputerRoutes, type ComputerProxyOptions } from "./routes/computer.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerWorkspaceFileRoutes } from "./routes/files.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerTaskListRoutes } from "./routes/tasks.js";
import type { TaskQueue } from "./services/chat-service.js";
import {
  RedisTaskEventSubscriber,
  type TaskEventPublisher,
  type TaskEventSubscriber
} from "./services/event-stream.js";
import { registerTaskEventRoutes } from "./routes/task-events.js";
import { registerTaskControlRoutes } from "./routes/task-controls.js";
import { registerRoutineRoutes } from "./routes/routines.js";

const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export type ApiDependencies = {
  repositories: Repositories;
  queue: TaskQueue;
  eventSubscriber?: TaskEventSubscriber;
  taskEventPublisher?: TaskEventPublisher;
  userId?: string;
  computer?: ComputerProxyOptions;
};

export function buildApp(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify();
  const eventSubscriber = dependencies.eventSubscriber ?? new RedisTaskEventSubscriber(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const routeDependencies: ApiDependencies & { eventSubscriber: TaskEventSubscriber } = { ...dependencies, eventSubscriber };
  registerRequestContext(app, dependencies.userId);
  registerBotRoutes(app, routeDependencies);
  registerConversationRoutes(app, routeDependencies);
  registerTaskListRoutes(app, routeDependencies);
  registerTaskEventRoutes(app, routeDependencies);
  registerTaskControlRoutes(app, routeDependencies);
  registerRoutineRoutes(app, routeDependencies);
  registerSkillRoutes(app, routeDependencies);
  registerWorkspaceFileRoutes(app);
  registerCredentialRoutes(app, routeDependencies);
  registerMemoryRoutes(app, routeDependencies);
  if (dependencies.computer) {
    registerComputerRoutes(app, routeDependencies, dependencies.computer);
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send(ErrorResponseSchema.parse({ error: "Invalid request" }));
    }
    return reply.code(500).send(ErrorResponseSchema.parse({ error: "Internal server error" }));
  });
  return app;
}
