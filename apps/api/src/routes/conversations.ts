import { ConversationSchema, MessageSchema, TaskSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { ChatService } from "../services/chat-service.js";

const CreateConversationInputSchema = z.object({ botId: z.string().min(1) });
const ConversationParamsSchema = z.object({ id: z.string().min(1) });
const CreateMessageInputSchema = z.object({ content: z.string().trim().min(1) });
const CreateConversationResponseSchema = z.object({ conversation: ConversationSchema });
const ListMessagesResponseSchema = z.object({ messages: z.array(MessageSchema) });
const SubmitMessageResponseSchema = z.object({ message: MessageSchema, task: TaskSchema });
const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export function registerConversationRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  const chatService = new ChatService(dependencies.repositories, dependencies.queue);

  app.post("/v1/conversations", async (request, reply) => {
    const input = CreateConversationInputSchema.parse(request.body);
    const conversation = ConversationSchema.parse(
      await dependencies.repositories.createConversation({ userId: request.userId, botId: input.botId })
    );
    return reply.code(201).send(CreateConversationResponseSchema.parse({ conversation }));
  });

  app.get("/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    if (!(await dependencies.repositories.getConversation(request.userId, id))) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Conversation not found" }));
    }
    const messages = await dependencies.repositories.listMessages(request.userId, id);
    return ListMessagesResponseSchema.parse({ messages });
  });

  app.post("/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const { content } = CreateMessageInputSchema.parse(request.body);
    const conversation = await dependencies.repositories.getConversation(request.userId, id);
    if (!conversation) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Conversation not found" }));
    }
    const result = await chatService.submitMessage({
      userId: request.userId,
      botId: conversation.botId,
      conversationId: id,
      content
    });
    return reply.code(202).send(SubmitMessageResponseSchema.parse(result));
  });
}
