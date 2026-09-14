import { z } from "zod";

const IdentifierSchema = z.string().min(1);
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

export type CreateBotInput = z.infer<typeof CreateBotInputSchema>;
export type Bot = z.infer<typeof BotSchema>;
