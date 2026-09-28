import {
  BotSchema,
  ConversationSchema,
  CreateBotInputSchema,
  ListModelCredentialsResponseSchema,
  ListSkillsResponseSchema,
  ListTasksResponseSchema,
  ListWorkspaceFilesResponseSchema,
  MessageSchema,
  ModelCredentialWriteSchema,
  TaskEventSchema,
  TaskSchema
} from "@vork/contracts";
import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);

export const ApiRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("listBots"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("listConversations"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("createBot"), input: CreateBotInputSchema.strict() }).strict(),
  z.object({ operation: z.literal("createConversation"), input: z.object({ botId: IdentifierSchema }).strict() }).strict(),
  z.object({ operation: z.literal("listMessages"), input: z.object({ conversationId: IdentifierSchema }).strict() }).strict(),
  z
    .object({
      operation: z.literal("submitMessage"),
      input: z.object({ conversationId: IdentifierSchema, content: z.string().trim().min(1) }).strict()
    })
    .strict(),
  z.object({ operation: z.literal("cancelTask"), input: z.object({ taskId: IdentifierSchema }).strict() }).strict(),
  z.object({ operation: z.literal("listTasks"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("listSkills"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("listFiles"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("listCredentials"), input: z.object({}).strict() }).strict(),
  z.object({ operation: z.literal("upsertCredential"), input: ModelCredentialWriteSchema.strict() }).strict(),
  z
    .object({
      operation: z.literal("deleteCredential"),
      input: z.object({ provider: z.literal("openai-compatible").default("openai-compatible") }).strict()
    })
    .strict(),
  z
    .object({
      operation: z.literal("deleteConversation"),
      input: z.object({ conversationId: IdentifierSchema }).strict()
    })
    .strict()
]);

export const ApiResponseSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("listBots"), data: z.object({ bots: z.array(BotSchema) }).strict() }).strict(),
  z.object({ operation: z.literal("listConversations"), data: z.object({ conversations: z.array(ConversationSchema) }).strict() }).strict(),
  z.object({ operation: z.literal("createBot"), data: z.object({ bot: BotSchema, conversation: ConversationSchema }).strict() }).strict(),
  z.object({ operation: z.literal("createConversation"), data: z.object({ conversation: ConversationSchema }).strict() }).strict(),
  z.object({ operation: z.literal("listMessages"), data: z.object({ messages: z.array(MessageSchema) }).strict() }).strict(),
  z.object({ operation: z.literal("submitMessage"), data: z.object({ message: MessageSchema, task: TaskSchema }).strict() }).strict(),
  z.object({ operation: z.literal("cancelTask"), data: z.object({ task: TaskSchema }).strict() }).strict(),
  z.object({ operation: z.literal("listTasks"), data: ListTasksResponseSchema }).strict(),
  z.object({ operation: z.literal("listSkills"), data: ListSkillsResponseSchema }).strict(),
  z.object({ operation: z.literal("listFiles"), data: ListWorkspaceFilesResponseSchema }).strict(),
  z.object({ operation: z.literal("listCredentials"), data: ListModelCredentialsResponseSchema }).strict(),
  z.object({ operation: z.literal("upsertCredential"), data: ListModelCredentialsResponseSchema }).strict(),
  z.object({ operation: z.literal("deleteCredential"), data: ListModelCredentialsResponseSchema }).strict(),
  z
    .object({
      operation: z.literal("deleteConversation"),
      data: z.object({ conversationId: IdentifierSchema }).strict()
    })
    .strict()
]);

export const TaskSubscriptionSchema = z.object({
  taskId: IdentifierSchema,
  afterSequence: z.number().int().nonnegative()
}).strict();

export const TaskEventMessageSchema = z.object({ taskId: IdentifierSchema, event: TaskEventSchema }).strict();

export const ComputerFrameRequestSchema = z
  .object({
    taskId: IdentifierSchema,
    slotId: IdentifierSchema
  })
  .strict();

export const ComputerFrameResponseSchema = z
  .object({
    base64: z.string().min(1)
  })
  .strict();

export type ApiRequest = z.infer<typeof ApiRequestSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type TaskEventListener = (event: z.infer<typeof TaskEventSchema>) => void;
export type ComputerFrameRequest = z.infer<typeof ComputerFrameRequestSchema>;
export type ComputerFrameResponse = z.infer<typeof ComputerFrameResponseSchema>;

type IpcRendererLike = {
  invoke(channel: "vork:request", input: ApiRequest): Promise<unknown>;
  invoke(channel: "vork:computer-frame", input: ComputerFrameRequest): Promise<unknown>;
  on(channel: "vork:task-event", listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: "vork:task-event", listener: (event: unknown, payload: unknown) => void): unknown;
  send(channel: "vork:subscribe-task" | "vork:unsubscribe-task", input: z.infer<typeof TaskSubscriptionSchema>): void;
};

export type VorkApi = {
  request(input: ApiRequest): Promise<ApiResponse>;
  subscribeTask(taskId: string, afterSequence: number, listener: TaskEventListener): () => void;
  getComputerFrame(taskId: string, slotId: string): Promise<ComputerFrameResponse>;
};

export function createVorkApi(ipcRenderer: IpcRendererLike): VorkApi {
  return {
    async request(input) {
      const parsedInput = ApiRequestSchema.parse(input);
      return ApiResponseSchema.parse(await ipcRenderer.invoke("vork:request", parsedInput));
    },

    subscribeTask(taskId, afterSequence, listener) {
      const subscription = TaskSubscriptionSchema.parse({ taskId, afterSequence });
      const onTaskEvent = (_event: unknown, payload: unknown) => {
        const result = TaskEventMessageSchema.safeParse(payload);
        if (result.success && result.data.taskId === subscription.taskId) listener(result.data.event);
      };

      ipcRenderer.on("vork:task-event", onTaskEvent);
      ipcRenderer.send("vork:subscribe-task", subscription);
      return () => {
        ipcRenderer.removeListener("vork:task-event", onTaskEvent);
        ipcRenderer.send("vork:unsubscribe-task", subscription);
      };
    },

    async getComputerFrame(taskId, slotId) {
      const input = ComputerFrameRequestSchema.parse({ taskId, slotId });
      return ComputerFrameResponseSchema.parse(await ipcRenderer.invoke("vork:computer-frame", input));
    }
  };
}
