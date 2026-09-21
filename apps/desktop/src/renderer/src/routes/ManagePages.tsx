import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  KeyRound,
  ListTodo,
  Settings,
  Sparkles,
  CircleDot,
  Clock3,
  Download,
  Plus
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const manageNav = [
  { title: "任务队列", description: "异步任务与待处理事项", path: "/tasks" as const, icon: ListTodo },
  { title: "Skills", description: "可复用操作手册与技能草稿", path: "/skills" as const, icon: Sparkles },
  { title: "文件", description: "云电脑工作区文件", path: "/files" as const, icon: FileText },
  { title: "模型凭据", description: "模型供应商与密钥", path: "/credentials" as const, icon: KeyRound }
];

export function ManagePage({
  title,
  description,
  path,
  children
}: {
  title: string;
  description: string;
  path: "/tasks" | "/skills" | "/files" | "/credentials";
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="border-b border-border/80 bg-card/80 px-5 py-3 backdrop-blur-sm sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 rounded-lg shadow-none"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-3.5" />
              设置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg shadow-none"
              onClick={() => void navigate({ to: "/" })}
            >
              <ArrowLeft className="size-3.5" />
              返回聊天
            </Button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {children}

          <nav aria-label="管理导航" className="grid gap-2 sm:grid-cols-2">
            {manageNav.map((item) => {
              const Icon = item.icon;
              const active = item.path === path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => void navigate({ to: item.path })}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition",
                    active
                      ? "border-primary/25 bg-primary-soft ring-1 ring-primary/15"
                      : "bg-card hover:bg-accent/60"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                      active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </section>
  );
}

function ShellList({
  rows,
  empty
}: {
  rows: Array<{ title: string; meta: string; badge?: string; badgeTone?: "default" | "primary" | "muted" }>;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/60 px-5 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-2xl border bg-card shadow-panel">
      {rows.map((row, index) => (
        <li key={`${row.title}-${index}`}>
          {index > 0 && <Separator />}
          <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/50">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CircleDot className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{row.title}</span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                <Clock3 className="size-3 shrink-0" aria-hidden />
                {row.meta}
              </span>
            </span>
            {row.badge && (
              <Badge
                variant={row.badgeTone === "primary" ? "default" : "secondary"}
                className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
              >
                {row.badge}
              </Badge>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TasksPage() {
  return (
    <ManagePage title="任务队列" description="查看异步任务、运行状态与等待你处理的事项。" path="/tasks">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">最近任务（示意）</p>
          <Badge variant="secondary" className="h-5 font-normal">
            本地
          </Badge>
        </div>
        <ShellList
          empty="暂无任务。在对话中发送消息后，任务会出现在这里。"
          rows={[
            { title: "回复用户消息", meta: "对话任务 · 刚才", badge: "已完成", badgeTone: "muted" },
            { title: "等待云电脑槽位", meta: "电脑演示 · 示例", badge: "排队", badgeTone: "primary" }
          ]}
        />
      </div>
    </ManagePage>
  );
}

export function SkillsPage() {
  return (
    <ManagePage title="Skills" description="管理 Bot 可复用的操作手册与技能草稿。" path="/skills">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">技能草稿</p>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[12px]" disabled>
            <Plus className="size-3.5" />
            新建（后续）
          </Button>
        </div>
        <ShellList
          empty="还没有 Skills。阶段后续会从成功任务中总结经验。"
          rows={[
            { title: "按需创建助手", meta: "对话 · 已发布", badge: "已发布" },
            { title: "取消进行中任务", meta: "对话 · 已发布", badge: "已发布" },
            { title: "打开受控演示页", meta: "浏览器 · 草稿", badge: "草稿" },
            { title: "整理工作区文件", meta: "文件 · 草稿", badge: "草稿" }
          ]}
        />
      </div>
    </ManagePage>
  );
}

export function FilesPage() {
  return (
    <ManagePage title="文件" description="浏览云电脑工作区中的文件与下载。" path="/files">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">工作区</p>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg text-[12px]" disabled>
            <Download className="size-3.5" />
            下载（后续）
          </Button>
        </div>
        <ShellList
          empty="工作区为空。电脑任务产生的文件会列在这里。"
          rows={[
            { title: "screenshot-preview.jpg", meta: "图片 · 示意", badge: "示例" },
            { title: "notes.md", meta: "文档 · 示意", badge: "示例" }
          ]}
        />
      </div>
    </ManagePage>
  );
}

/** Deep-link /settings → open modal；不把设置做成整页主体验。 */
export function SettingsPage() {
  const navigate = useNavigate();
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  useEffect(() => {
    setSettingsOpen(true);
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [navigate, setSettingsOpen]);

  return (
    <p className="m-auto text-[13px] text-muted-foreground" role="status">
      正在打开系统设置…
    </p>
  );
}
