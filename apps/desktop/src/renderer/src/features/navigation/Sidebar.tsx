import type { Bot } from "@vork/contracts";

export function Sidebar({ bots, selectedBotId, onNewChat, onSelectBot }: {
  bots: Bot[];
  selectedBotId?: string;
  onNewChat: () => void;
  onSelectBot: (bot: Bot) => void;
}) {
  return <aside className="sidebar">
    <div className="sidebar-top"><button type="button" aria-label="新建聊天" onClick={onNewChat}>+</button></div>
    <label className="search"><span>搜索</span><input aria-label="搜索" type="search" /></label>
    <nav aria-label="Bot 对话"><p>Bot 与对话</p>{bots.map((bot) => <button type="button" className={bot.id === selectedBotId ? "selected" : ""} key={bot.id} onClick={() => onSelectBot(bot)}>{bot.name}</button>)}</nav>
    <details className="identity"><summary>本地用户</summary><a href="#queue">任务队列</a><a href="#skills">Skills</a><a href="#files">文件</a><a href="#credentials">模型凭据</a><a href="#settings">系统设置</a></details>
  </aside>;
}
