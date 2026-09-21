export type ModelMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ModelInput = {
  botId: string;
  conversationId: string;
  userMessage: string;
  /** Bot persona 等系统提示；真实供应商会注入为 system message */
  systemPrompt?: string;
  /** 对话历史（含当前用户消息）；缺省时仅用 userMessage */
  messages?: ModelMessage[];
  /** 任务取消时中断上游流式请求 */
  signal?: AbortSignal;
};

export type ModelProvider = {
  streamReply(input: ModelInput): AsyncIterable<string>;
};
