import { ListSkillsResponseSchema, SkillSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { stubSkills } from "../services/manage-stubs.js";

const SaveSkillSchema = z.object({
  taskId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80).optional()
});

export function registerSkillRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  app.get("/v1/skills", async (request) => {
    const stub = stubSkills();
    const proposals = await dependencies.repositories.listSkillProposals(request.userId);
    if (proposals.length === 0) return stub;
    const drafts = proposals.map((proposal) =>
      SkillSchema.parse({
        id: proposal.id,
        name: proposal.name,
        kind: "chat",
        kindLabel: "对话",
        status: "draft",
        statusLabel: "草稿",
        summary: proposal.summary,
        updatedAt: proposal.createdAt
      })
    );
    return ListSkillsResponseSchema.parse({
      source: "database",
      skills: [...drafts, ...stub.skills]
    });
  });

  app.post("/v1/skills", async (request, reply) => {
    const body = SaveSkillSchema.parse(request.body);
    const task = await dependencies.repositories.getTask(body.taskId);
    if (!task || task.userId !== request.userId) {
      return reply.code(404).send({ error: "任务不存在" });
    }
    if (task.status !== "completed") {
      return reply.code(409).send({ error: "仅已完成任务可保存为 Skill 草稿" });
    }
    const messages = await dependencies.repositories.listMessages({
      userId: task.userId,
      conversationId: task.conversationId
    });
    const userText = messages.find((message) => message.id === task.messageId)?.content ?? "任务";
    const assistantText = [...messages].reverse().find((message) => message.authorType === "assistant")?.content ?? "已完成";
    const proposal = await dependencies.repositories.createSkillProposal({
      userId: task.userId,
      botId: task.botId,
      taskId: task.id,
      name: body.name ?? `${userText.replace(/\s+/g, " ").trim().slice(0, 40) || "任务"} 流程`,
      summary: assistantText.replace(/\s+/g, " ").trim().slice(0, 280)
    });
    return { skill: { id: proposal.id, status: proposal.status } };
  });
}
