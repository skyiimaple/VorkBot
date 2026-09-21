import type { Bot, Conversation } from "@vork/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVorkApi } from "@/features/chat/useConversation";

export const workspaceKeys = {
  all: ["workspace"] as const,
  bots: () => [...workspaceKeys.all, "bots"] as const,
  conversations: () => [...workspaceKeys.all, "conversations"] as const
};

export function useBotsQuery() {
  const api = useVorkApi();
  return useQuery({
    queryKey: workspaceKeys.bots(),
    queryFn: async () => {
      const response = await api.request({ operation: "listBots", input: {} });
      if (response.operation !== "listBots") throw new Error("Unexpected listBots response");
      return response.data.bots;
    }
  });
}

export function useConversationsQuery() {
  const api = useVorkApi();
  return useQuery({
    queryKey: workspaceKeys.conversations(),
    queryFn: async () => {
      const response = await api.request({ operation: "listConversations", input: {} });
      if (response.operation !== "listConversations") throw new Error("Unexpected listConversations response");
      return response.data.conversations;
    }
  });
}

export function useCreateBotMutation() {
  const api = useVorkApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; persona?: string }) => {
      const response = await api.request({
        operation: "createBot",
        input: { name: input.name, persona: input.persona ?? "待通过对话设置" }
      });
      if (response.operation !== "createBot") throw new Error("Unexpected createBot response");
      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.bots() }),
        queryClient.invalidateQueries({ queryKey: workspaceKeys.conversations() })
      ]);
    }
  });
}

export function useCreateConversationMutation() {
  const api = useVorkApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await api.request({ operation: "createConversation", input: { botId } });
      if (response.operation !== "createConversation") throw new Error("Unexpected createConversation response");
      return response.data.conversation;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.conversations() });
    }
  });
}

export function findConversationForBot(conversations: Conversation[] | undefined, bot: Bot): Conversation | undefined {
  return conversations?.find((item) => item.botId === bot.id);
}
