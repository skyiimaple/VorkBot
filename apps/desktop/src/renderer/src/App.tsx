import type { Bot, Conversation } from "@vork/contracts";
import { useEffect, useState } from "react";
import { ConversationView } from "./features/chat/ConversationView.js";
import { NewChatRecipientPicker } from "./features/chat/NewChatRecipientPicker.js";
import { VorkApiProvider } from "./features/chat/useConversation.js";
import { Sidebar } from "./features/navigation/Sidebar.js";

export default function App({ api = window.vorkApi }: { api?: import("../../preload/api.js").VorkApi }) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation>();
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    void Promise.all([api.request({ operation: "listBots", input: {} }), api.request({ operation: "listConversations", input: {} })]).then(([botsResponse, conversationsResponse]) => {
      if (botsResponse.operation === "listBots") setBots(botsResponse.data.bots);
      if (conversationsResponse.operation === "listConversations") {
        setConversations(conversationsResponse.data.conversations);
        setConversation(conversationsResponse.data.conversations[0]);
      }
    });
  }, [api]);

  async function createBot() {
    const response = await api.request({ operation: "createBot", input: { name: "新建 Bot", persona: "待通过对话设置" } });
    if (response.operation !== "createBot") return;
    setBots((current) => [...current, response.data.bot]);
    setConversations((current) => [response.data.conversation, ...current]);
    setConversation(response.data.conversation);
    setShowPicker(false);
  }

  async function selectBot(bot: Bot) {
    const existing = conversations.find((conversation) => conversation.botId === bot.id);
    if (existing) {
      setConversation(existing);
      setShowPicker(false);
      return;
    }
    const response = await api.request({ operation: "createConversation", input: { botId: bot.id } });
    if (response.operation !== "createConversation") return;
    setConversations((current) => [response.data.conversation, ...current]);
    setConversation(response.data.conversation);
    setShowPicker(false);
  }

  const selectedBot = bots.find((bot) => bot.id === conversation?.botId);
  return <VorkApiProvider api={api}><main className="app-shell"><Sidebar bots={bots} conversations={conversations} selectedConversationId={conversation?.id} onNewChat={() => setShowPicker(true)} onSelectConversation={setConversation} /><div className="main-panel">{showPicker ? <NewChatRecipientPicker bots={bots} onCreateBot={createBot} onSelectBot={selectBot} /> : conversation && selectedBot ? <ConversationView conversationId={conversation.id} botName={selectedBot.name} /> : <section className="empty-state"><h1>Vork</h1><p>选择一个 Bot 或开始新聊天。</p></section>}</div></main></VorkApiProvider>;
}
