import { ListTasksResponseSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { toTaskListItem } from "../services/manage-stubs.js";

const ListTasksQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional()
});

export function registerTaskListRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/tasks", async (request) => {
    const { limit } = ListTasksQuerySchema.parse(request.query);
    const rows = await dependencies.repositories.listTasks(request.userId, limit ?? 50);
    return ListTasksResponseSchema.parse({
      tasks: rows.map((row) => toTaskListItem(row.task, row.messageContent))
    });
  });
}
