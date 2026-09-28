import { ConversationSchema, MessageSchema, TaskPublicationFailureResponseSchema, TaskSchema } from "@vork/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiDependencies } from "../app.js";
import { ChatService } from "../services/chat-service.js";

const CreateConversationInputSchema = z.object({ botId: z.string().trim().min(1) });
const ConversationParamsSchema = z.object({ id: z.string().trim().min(1) });
const CreateMessageInputSchema = z.object({ content: z.string().trim().min(1) });
const CreateConversationResponseSchema = z.object({ conversation: ConversationSchema });
const ListMessagesResponseSchema = z.object({ messages: z.array(MessageSchema) });
const ListConversationsResponseSchema = z.object({ conversations: z.array(ConversationSchema) });
const SubmitMessageResponseSchema = z.object({ message: MessageSchema, task: TaskSchema });
const DeleteConversationResponseSchema = z.object({ conversationId: z.string().trim().min(1) });
const ErrorResponseSchema = z.object({ error: z.string().min(1) });

export function registerConversationRoutes(app: FastifyInstance, dependencies: ApiDependencies): void {
  const chatService = new ChatService(dependencies.repositories, dependencies.queue);

  app.get("/v1/conversations", async (request) => {
    const conversations = await dependencies.repositories.listConversations(request.userId);
    return ListConversationsResponseSchema.parse({ conversations });
  });

  app.post("/v1/conversations", async (request, reply) => {
    const input = CreateConversationInputSchema.parse(request.body);
    if (!(await dependencies.repositories.getBot({ userId: request.userId, botId: input.botId }))) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Bot not found" }));
    }
    const conversation = ConversationSchema.parse(
      await dependencies.repositories.createConversation({ userId: request.userId, botId: input.botId })
    );
    return reply.code(201).send(CreateConversationResponseSchema.parse({ conversation }));
  });

  app.get("/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const conversation = await dependencies.repositories.getConversation({ userId: request.userId, conversationId: id });
    if (!conversation) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Conversation not found" }));
    }
    ConversationSchema.parse(conversation);
    const messages = await dependencies.repositories.listMessages({ userId: request.userId, conversationId: id });
    return ListMessagesResponseSchema.parse({ messages });
  });

  app.post("/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const { content } = CreateMessageInputSchema.parse(request.body);
    const conversation = await dependencies.repositories.getConversation({ userId: request.userId, conversationId: id });
    if (!conversation) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Conversation not found" }));
    }
    const validatedConversation = ConversationSchema.parse(conversation);
    const result = await chatService.submitMessage({
      userId: request.userId,
      botId: validatedConversation.botId,
      conversationId: id,
      content
    });
    if (result.kind === "publication_failed") {
      return reply.code(503).send(TaskPublicationFailureResponseSchema.parse(result.response));
    }
    return reply.code(202).send(SubmitMessageResponseSchema.parse(result));
  });

  app.delete("/v1/conversations/:id", async (request, reply) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const deleted = await dependencies.repositories.deleteConversation({
      userId: request.userId,
      conversationId: id
    });
    if (!deleted) {
      return reply.code(404).send(ErrorResponseSchema.parse({ error: "Conversation not found" }));
    }
    return DeleteConversationResponseSchema.parse({ conversationId: id });
  });
}
