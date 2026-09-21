import { useNavigate } from "@tanstack/react-router";
import { NewChatRecipientPicker } from "@/features/chat/NewChatRecipientPicker";
import {
  findConversationForBot,
  useBotsQuery,
  useConversationsQuery,
  useCreateBotMutation,
  useCreateConversationMutation
} from "@/features/workspace/useWorkspace";

export function NewChatPage() {
  const navigate = useNavigate();
  const botsQuery = useBotsQuery();
  const conversationsQuery = useConversationsQuery();
  const createBot = useCreateBotMutation();
  const createConversation = useCreateConversationMutation();

  return (
    <NewChatRecipientPicker
      bots={botsQuery.data ?? []}
      onCancel={() => void navigate({ to: "/" })}
      onCreateBot={async (name) => {
        const data = await createBot.mutateAsync({ name });
        await navigate({ to: "/c/$conversationId", params: { conversationId: data.conversation.id } });
      }}
      onSelectBot={async (bot) => {
        const existing = findConversationForBot(conversationsQuery.data, bot);
        if (existing) {
          await navigate({ to: "/c/$conversationId", params: { conversationId: existing.id } });
          return;
        }
        const conversation = await createConversation.mutateAsync(bot.id);
        await navigate({ to: "/c/$conversationId", params: { conversationId: conversation.id } });
      }}
    />
  );
}
