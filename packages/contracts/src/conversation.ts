import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();

export const ConversationSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  botId: IdentifierSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
});

export const MessageSchema = z.object({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  conversationId: IdentifierSchema,
  authorType: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  createdAt: DateTimeSchema
});

export const CreateConversationRepositoryInputSchema = z.object({
  userId: IdentifierSchema,
  botId: IdentifierSchema
});

export const GetBotInputSchema = z.object({
  userId: IdentifierSchema,
  botId: IdentifierSchema
});

export const GetConversationInputSchema = z.object({
  userId: IdentifierSchema,
  conversationId: IdentifierSchema
});

export const ListMessagesInputSchema = GetConversationInputSchema;

export const ListConversationsInputSchema = z.object({
  userId: IdentifierSchema
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type CreateConversationRepositoryInput = z.infer<typeof CreateConversationRepositoryInputSchema>;
export type GetBotInput = z.infer<typeof GetBotInputSchema>;
export type GetConversationInput = z.infer<typeof GetConversationInputSchema>;
export type ListMessagesInput = z.infer<typeof ListMessagesInputSchema>;
export type ListConversationsInput = z.infer<typeof ListConversationsInputSchema>;
