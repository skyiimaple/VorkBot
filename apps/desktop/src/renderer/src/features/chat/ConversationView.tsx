import { MessageComposer } from "./MessageComposer.js";
import { useConversation } from "./useConversation.js";

export function ConversationView({ conversationId, botName }: { conversationId: string; botName: string }) {
  const { messages, activeTask, connectionState, sendMessage } = useConversation(conversationId);
  return <section className="conversation" aria-busy={connectionState === "loading"}>
    <header><h1>{botName}</h1><div className="header-actions" aria-label="对话操作" /></header>
    <div className="messages" aria-live="polite">{messages.length === 0 ? <p>开始与 {botName} 对话。</p> : messages.map((message) => <article className={`message ${message.authorType}`} key={message.id}><p>{message.content}</p></article>)}</div>
    {activeTask && <p className="task-status">任务：{activeTask.status}</p>}
    <MessageComposer onSend={sendMessage} disabled={connectionState !== "ready"} />
  </section>;
}
