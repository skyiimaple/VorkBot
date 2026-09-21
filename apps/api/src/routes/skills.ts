import { ListSkillsResponseSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { stubSkills } from "../services/manage-stubs.js";

export function registerSkillRoutes(app: FastifyInstance): void {
  app.get("/v1/skills", async () => {
    return ListSkillsResponseSchema.parse(stubSkills());
  });
}
