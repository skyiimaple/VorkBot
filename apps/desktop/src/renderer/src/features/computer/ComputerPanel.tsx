import { useEffect, useState } from "react";
import type { VorkApi } from "../../../../preload/api.js";

type ComputerPanelProps = {
  api: VorkApi;
  taskId?: string;
  slotId?: string;
  open: boolean;
};

export function ComputerPanel({ api, taskId, slotId, open }: ComputerPanelProps) {
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

  return (
    <aside className="computer-panel" aria-label="云电脑画面">
      {!taskId || !slotId ? (
        <p>等待云电脑槽位…</p>
      ) : error ? (
        <p>{error}</p>
      ) : frameUrl ? (
        <img src={frameUrl} alt="云电脑画面" />
      ) : (
        <p>加载画面中…</p>
      )}
    </aside>
  );
}
