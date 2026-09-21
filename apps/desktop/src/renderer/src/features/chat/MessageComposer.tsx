import { ArrowUp, FileIcon, ImageIcon, Paperclip, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PendingAttachment = {
  id: string;
  name: string;
  size: number;
  kind: "image" | "file";
};

export function MessageComposer({
  onSend,
  onStop,
  disabled,
  working
}: {
  onSend: (content: string) => Promise<void>;
  onStop?: () => Promise<void> | void;
  disabled?: boolean;
  working?: boolean;
}) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const attachInputId = useId();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [content]);

  function addFiles(fileList: FileList | File[]) {
    const next = Array.from(fileList).slice(0, 8).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      size: file.size,
      kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const)
    }));
    if (next.length === 0) return;
    setAttachments((current) => [...current, ...next].slice(0, 8));
  }

  async function submit() {
    const next = content.trim();
    const attachmentNote =
      attachments.length > 0
        ? `\n\n[附件 · 本地预览未上传]\n${attachments.map((item) => `- ${item.name}`).join("\n")}`
        : "";
    const payload = `${next}${attachmentNote}`.trim();
    if (!payload || disabled || sending) return;
    setSending(true);
    try {
      await onSend(payload);
      setContent("");
      setAttachments([]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function stop() {
    if (!onStop || stopping || !working) return;
    setStopping(true);
    try {
      await onStop();
    } finally {
      setStopping(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const canSend = !disabled && !sending && (Boolean(content.trim()) || attachments.length > 0);
  const showStop = Boolean(working && onStop);

  return (
    <form
      className="composer w-full"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
      }}
    >
      <div
        className={cn(
          "relative rounded-3xl border bg-card px-2 pt-2 pb-2 shadow-composer transition",
          "focus-within:border-primary/35 focus-within:shadow-[0_0_0_3px_var(--primary-soft)]",
          dragging && "border-primary/50 bg-primary-soft/40"
        )}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border border-dashed border-primary/40 bg-card/90">
            <p className="text-[13px] font-medium text-primary">松开以添加附件</p>
          </div>
        )}

        {attachments.length > 0 && (
          <ul className="mb-1 flex flex-wrap gap-1.5 px-2 pt-1" aria-label="待发送附件">
            {attachments.map((item) => (
              <li
                key={item.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/60 py-1 pr-1 pl-2 text-[12px]"
              >
                {item.kind === "image" ? (
                  <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{item.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`移除 ${item.name}`}
                  className="size-5"
                  onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== item.id))}
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <label className="sr-only" htmlFor="message">
          消息
        </label>
        <Textarea
          ref={textareaRef}
          id="message"
          value={content}
          disabled={disabled || sending}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={working ? "生成中…可点停止，或发送「停 / 取消」" : "发消息给 Bot，或拖入文件"}
          rows={1}
          className="max-h-48 min-h-[2.5rem] resize-none border-0 bg-transparent px-3 py-2 text-[14px] leading-relaxed shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInputRef}
              id={attachInputId}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加附件"
                  disabled={disabled || sending}
                  className="size-8 rounded-full text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>添加附件</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加图片"
                  disabled={disabled || sending}
                  className="size-8 rounded-full text-muted-foreground"
                  onClick={() => {
                    if (!fileInputRef.current) return;
                    fileInputRef.current.accept = "image/*";
                    fileInputRef.current.click();
                    window.setTimeout(() => {
                      if (fileInputRef.current) fileInputRef.current.accept = "";
                    }, 0);
                  }}
                >
                  <ImageIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>添加图片</TooltipContent>
            </Tooltip>
            <p className="ml-1 hidden text-[11px] text-muted-foreground sm:inline">
              {working ? "可说「停」取消 · Enter 仍可发指令" : "Enter 发送 · Shift+Enter 换行"}
            </p>
          </div>
          {showStop ? (
            <Button
              type="button"
              size="icon-sm"
              disabled={stopping}
              aria-label="停止"
              title="停止生成"
              onClick={() => void stop()}
              className="size-8 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/90"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSend}
              aria-label="发送"
              className={cn(
                "size-8 rounded-full shadow-none",
                canSend ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground"
              )}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
