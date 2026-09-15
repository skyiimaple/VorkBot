export type ModelInput = {
  botId: string;
  conversationId: string;
  userMessage: string;
};

export type ModelProvider = {
  streamReply(input: ModelInput): AsyncIterable<string>;
};
