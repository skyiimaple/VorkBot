import { ListWorkspaceFilesResponseSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { stubWorkspaceFiles } from "../services/manage-stubs.js";

export function registerWorkspaceFileRoutes(app: FastifyInstance): void {
  app.get("/v1/files", async () => {
    return ListWorkspaceFilesResponseSchema.parse(stubWorkspaceFiles());
  });
}
