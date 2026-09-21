import { useParams } from "@tanstack/react-router";
import { ConversationView } from "@/features/chat/ConversationView";
import { useBotsQuery, useConversationsQuery } from "@/features/workspace/useWorkspace";
import { useUiStore } from "@/stores/ui-store";

export function ConversationPage() {
  const params = useParams({ strict: false }) as { conversationId?: string };
  const conversationId = params.conversationId ?? "";
  const botsQuery = useBotsQuery();
  const conversationsQuery = useConversationsQuery();
  const botNameOverrides = useUiStore((state) => state.botNameOverrides);
  const conversation = conversationsQuery.data?.find((item) => item.id === conversationId);
  const bot = botsQuery.data?.find((item) => item.id === conversation?.botId);
  const botName = bot ? botNameOverrides[bot.id]?.trim() || bot.name : "";

  if (conversationsQuery.isLoading || botsQuery.isLoading) {
    return <p className="m-auto text-[13px] text-muted-foreground">加载对话…</p>;
  }

  if (!conversation || !bot) {
    return <p className="m-auto text-[13px] text-muted-foreground">未找到该对话</p>;
  }

  return <ConversationView conversationId={conversation.id} botName={botName} />;
}
