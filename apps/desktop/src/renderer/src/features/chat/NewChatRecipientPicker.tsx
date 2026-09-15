import type { Bot } from "@vork/contracts";
import { useState } from "react";

export function NewChatRecipientPicker({ bots, onCreateBot, onSelectBot }: {
  bots: Bot[];
  onCreateBot: () => Promise<void>;
  onSelectBot: (bot: Bot) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const shownBots = bots.filter((bot) => bot.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  async function choose(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return <section className="recipient-picker" aria-label="新聊天收件人">
    <label htmlFor="recipient-search">收件人</label>
    <input id="recipient-search" role="combobox" aria-expanded="true" aria-controls="recipient-options" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
    <div id="recipient-options" role="listbox" aria-label="收件人选项">
      <button type="button" role="option" aria-selected="false" disabled={busy} onClick={() => void choose(onCreateBot)}>创建新 Bot</button>
      {shownBots.map((bot) => <button type="button" role="option" aria-selected="false" disabled={busy} key={bot.id} onClick={() => void choose(() => onSelectBot(bot))}>{bot.name}</button>)}
    </div>
  </section>;
}
