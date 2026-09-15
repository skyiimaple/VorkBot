import type { Bot, Conversation } from "@vork/contracts";

export function Sidebar({ bots, conversations, selectedConversationId, onNewChat, onSelectConversation }: {
  bots: Bot[];
  conversations: Conversation[];
  selectedConversationId?: string;
  onNewChat: () => void;
  onSelectConversation: (conversation: Conversation) => void;
}) {
  return <aside className="sidebar">
    <div className="sidebar-top"><button type="button" aria-label="新建聊天" onClick={onNewChat}>+</button></div>
    <label className="search"><span>搜索</span><input aria-label="搜索" type="search" /></label>
    <nav aria-label="Bot 对话"><p>Bot 与对话</p>{conversations.map((conversation) => { const bot = bots.find((item) => item.id === conversation.botId); return bot ? <button type="button" className={conversation.id === selectedConversationId ? "selected" : ""} key={conversation.id} onClick={() => onSelectConversation(conversation)}>{bot.name}</button> : null; })}</nav>
    <details className="identity"><summary>本地用户</summary><span>任务队列</span><span>Skills</span><span>文件</span><span>模型凭据</span><span>系统设置</span></details>
  </aside>;
}
