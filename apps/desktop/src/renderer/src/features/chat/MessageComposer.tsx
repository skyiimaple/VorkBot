import { useState } from "react";

export function MessageComposer({ onSend, disabled }: { onSend: (content: string) => Promise<void>; disabled?: boolean }) {
  const [content, setContent] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = content.trim();
    if (!next || disabled) return;
    await onSend(next);
    setContent("");
  }
  return <form className="composer" onSubmit={(event) => void submit(event)}><label className="sr-only" htmlFor="message">消息</label><textarea id="message" value={content} disabled={disabled} onChange={(event) => setContent(event.target.value)} placeholder="给 Bot 发送消息" /><button type="submit" disabled={disabled || !content.trim()}>发送</button></form>;
}
