import { ListModelCredentialsResponseSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { stubModelCredentials } from "../services/manage-stubs.js";

export function registerCredentialRoutes(app: FastifyInstance): void {
  app.get("/v1/credentials", async () => {
    return ListModelCredentialsResponseSchema.parse(stubModelCredentials());
  });
}
