import { z } from "zod";

const ComputerConfigSchema = z.object({
  token: z.string().min(1),
  port: z.coerce.number().int().positive().default(8080),
  maxSlots: z.coerce.number().int().positive().default(1),
  host: z.string().min(1).default("127.0.0.1")
});

export type ComputerConfig = z.infer<typeof ComputerConfigSchema>;

export function loadConfig(): ComputerConfig {
  return ComputerConfigSchema.parse({
    token: process.env.VORK_COMPUTER_TOKEN,
    port: process.env.PORT,
    maxSlots: process.env.VORK_MAX_SLOTS,
    host: process.env.HOST
  });
}
