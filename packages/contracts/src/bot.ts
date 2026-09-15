import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const DateTimeSchema = z.string().datetime();
const TrimmedTextSchema = z.string().trim().min(1);

export const CreateBotInputSchema = z.object({
  name: TrimmedTextSchema,
  persona: TrimmedTextSchema
});

export const BotSchema = CreateBotInputSchema.extend({
  id: IdentifierSchema,
  userId: IdentifierSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema
});

export const CreateBotRepositoryInputSchema = CreateBotInputSchema.extend({
  userId: IdentifierSchema
});

export const ListBotsInputSchema = z.object({
  userId: IdentifierSchema
});

export type CreateBotInput = z.infer<typeof CreateBotInputSchema>;
export type Bot = z.infer<typeof BotSchema>;
export type CreateBotRepositoryInput = z.infer<typeof CreateBotRepositoryInputSchema>;
export type ListBotsInput = z.infer<typeof ListBotsInputSchema>;
