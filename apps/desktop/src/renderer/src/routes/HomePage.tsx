import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomePage() {
  const navigate = useNavigate();
  return (
    <section className="m-auto flex max-w-md flex-col items-center gap-3 px-6 text-center">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-card text-[20px] font-semibold shadow-panel ring-1 ring-border">
        V
      </div>
      <h1 className="text-[1.4rem] font-semibold tracking-tight">创建你的第一个 Bot</h1>
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        点击左侧 + 开始新聊天，或从侧栏选择已有 Bot 继续对话。
      </p>
      <Button type="button" className="mt-1 gap-1.5 rounded-xl px-4" onClick={() => void navigate({ to: "/new" })}>
        <Plus className="size-4" />
        开始新对话
      </Button>
    </section>
  );
}
