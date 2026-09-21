import { MonitorSmartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { VorkApi } from "../../../../preload/api.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ComputerPanelProps = {
  api: VorkApi;
  taskId?: string;
  slotId?: string;
  open: boolean;
  onClose?: () => void;
  layout?: "inline" | "side";
};

export function ComputerPanel({ api, taskId, slotId, open, onClose, layout = "side" }: ComputerPanelProps) {
  const [frameUrl, setFrameUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open || !taskId || !slotId) {
      setFrameUrl(undefined);
      setError(undefined);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const frame = await api.getComputerFrame(taskId, slotId);
        if (cancelled) return;
        setFrameUrl(`data:image/jpeg;base64,${frame.base64}`);
        setError(undefined);
      } catch {
        if (!cancelled) setError("画面暂不可用");
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, open, slotId, taskId]);

  if (!open) return null;

  const side = layout === "side";

  return (
    <aside
      className={
        side
          ? "computer-panel flex h-full min-h-0 w-full flex-col border-l border-border bg-card"
          : "computer-panel mt-3 overflow-hidden rounded-2xl border bg-card shadow-panel"
      }
      aria-label="云电脑画面"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorSmartphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="truncate text-[12px] font-medium">电脑预览</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
            {slotId ? `槽位 ${slotId}` : "等待槽位"}
          </Badge>
          {onClose && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭电脑预览" onClick={onClose} className="size-7">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className={side ? "min-h-0 flex-1 overflow-auto bg-muted/30 p-3" : "min-h-[11rem] bg-muted/30 p-3"}>
        {!taskId || !slotId ? (
          <div className={`flex flex-col items-center justify-center gap-1.5 text-center ${side ? "h-full min-h-[12rem]" : "py-10"}`}>
            <p className="m-0 text-[13px] text-muted-foreground">等待云电脑槽位…</p>
            <p className="m-0 text-[11px] text-muted-foreground/80">发送含演示标记的消息后会在此显示画面</p>
          </div>
        ) : error ? (
          <p className={`m-0 text-center text-[13px] text-muted-foreground ${side ? "py-16" : "py-10"}`}>{error}</p>
        ) : frameUrl ? (
          <img
            src={frameUrl}
            alt="云电脑画面"
            className={side ? "block w-full rounded-lg bg-black object-contain" : "block max-h-[22.5rem] w-full rounded-lg bg-black object-contain"}
          />
        ) : (
          <p className={`m-0 text-center text-[13px] text-muted-foreground ${side ? "py-16" : "py-10"}`}>加载画面中…</p>
        )}
      </div>
    </aside>
  );
}
