import { useEffect, useState } from "react";
import { MarkdownContent } from "./MarkdownContent.js";
import { STREAM_MARKDOWN_SETTLE_MS, useTypewriterReveal } from "./useTypewriterReveal.js";
import { cn } from "@/lib/utils";

/**
 * 流式追赶中用轻量纯文本，避免每 tick 全量 remark/rehype（尤其代码高亮）掉帧、闪烁。
 * 追齐并 settle 后再切完整 Markdown。
 */
export function StreamingPlainText({
  content,
  showCursor,
  className
}: {
  content: string;
  showCursor?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("markdown-body text-[14px] leading-relaxed text-foreground", className)}
      data-streaming-plain="true"
    >
      <p className="m-0 whitespace-pre-wrap break-words">{content}</p>
      {showCursor ? <span className="markdown-cursor" aria-hidden /> : null}
    </div>
  );
}

export function AssistantMessageBody({
  content,
  animate,
  onDisplayChange
}: {
  content: string;
  /** 流式草稿（id 以 stream- 开头）为 true：打字机追赶，不瞬间刷完。 */
  animate: boolean;
  onDisplayChange?: () => void;
}) {
  const revealed = useTypewriterReveal(content, animate);
  const catchingUp = animate && revealed.length < content.length;
  const [renderMarkdown, setRenderMarkdown] = useState(!animate);

  useEffect(() => {
    if (!animate) {
      setRenderMarkdown(true);
      return;
    }
    if (revealed.length < content.length) {
      setRenderMarkdown(false);
      return;
    }
    // 已追齐：稍等再切 Markdown，避免 SSE chunk 间隙反复切换导致闪烁。
    const timer = window.setTimeout(() => setRenderMarkdown(true), STREAM_MARKDOWN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [animate, revealed.length, content.length]);

  useEffect(() => {
    onDisplayChange?.();
  }, [revealed, catchingUp, renderMarkdown, onDisplayChange]);

  if (!renderMarkdown) {
    return <StreamingPlainText content={revealed} showCursor={catchingUp} />;
  }

  return <MarkdownContent content={content.length === revealed.length ? content : revealed} showCursor={false} />;
}
