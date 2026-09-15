import type { Bot, Conversation } from "@vork/contracts";
import { useEffect, useState } from "react";
import { ConversationView } from "./features/chat/ConversationView.js";
import { NewChatRecipientPicker } from "./features/chat/NewChatRecipientPicker.js";
import { VorkApiProvider } from "./features/chat/useConversation.js";
import { Sidebar } from "./features/navigation/Sidebar.js";

export default function App({ api = window.vorkApi }: { api?: import("../../preload/api.js").VorkApi }) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [conversation, setConversation] = useState<Conversation>();
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    void api.request({ operation: "listBots", input: {} }).then((response) => {
      if (response.operation === "listBots") setBots(response.data.bots);
    });
  }, [api]);

  async function createBot() {
    const response = await api.request({ operation: "createBot", input: { name: "新建 Bot", persona: "待通过对话设置" } });
    if (response.operation !== "createBot") return;
    setBots((current) => [...current, response.data.bot]);
    setConversation(response.data.conversation);
    setShowPicker(false);
  }

  async function selectBot(bot: Bot) {
    const response = await api.request({ operation: "createConversation", input: { botId: bot.id } });
    if (response.operation !== "createConversation") return;
    setConversation(response.data.conversation);
    setShowPicker(false);
  }

  const selectedBot = bots.find((bot) => bot.id === conversation?.botId);
  return <VorkApiProvider api={api}><main className="app-shell"><Sidebar bots={bots} selectedBotId={selectedBot?.id} onNewChat={() => setShowPicker(true)} onSelectBot={(bot) => void selectBot(bot)} /><div className="main-panel">{showPicker ? <NewChatRecipientPicker bots={bots} onCreateBot={createBot} onSelectBot={selectBot} /> : conversation && selectedBot ? <ConversationView conversationId={conversation.id} botName={selectedBot.name} /> : <section className="empty-state"><h1>Vork</h1><p>选择一个 Bot 或开始新聊天。</p></section>}</div></main></VorkApiProvider>;
}
