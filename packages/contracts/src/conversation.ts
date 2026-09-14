import { z } from "zod";

const IdentifierSchema = z.string().min(1);
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

export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
