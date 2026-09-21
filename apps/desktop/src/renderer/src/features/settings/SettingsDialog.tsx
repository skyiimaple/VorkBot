import { Monitor, Bell, Palette, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const sections = [
  { id: "account" as const, label: "账户", icon: User },
  { id: "appearance" as const, label: "外观", icon: Palette },
  { id: "notifications" as const, label: "通知", icon: Bell },
  { id: "computer" as const, label: "电脑", icon: Monitor }
];

type SectionId = (typeof sections)[number]["id"];

export function SettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const [section, setSection] = useState<SectionId>("account");

  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      {/* Fixed shell height (Grok-like): content panes scroll inside, never resize the dialog. */}
      <DialogContent className="flex h-[min(86vh,32rem)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-[16px]">系统设置</DialogTitle>
          <DialogDescription className="text-[12px]">
            账户、外观与电脑相关偏好。关闭后回到当前页面。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[9.5rem_minmax(0,1fr)] max-sm:grid-cols-1">
          <nav
            aria-label="设置分区"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-muted/30 p-2 max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b"
          >
            {sections.map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                    active
                      ? "bg-primary-soft font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="scrollbar-grok min-h-0 overflow-y-auto px-5 py-4">
            {section === "account" && (
              <SettingsBlock title="本地账户" hint="阶段 1 使用本机开发用户，无需登录。">
                <Row label="显示名称" value="本地用户" />
                <Row label="用户 ID" value="user_local" mono />
              </SettingsBlock>
            )}
            {section === "appearance" && (
              <SettingsBlock title="外观" hint="当前固定浅色 Sand 主题，与 Grok 桌面浅色对齐。">
                <Row label="主题" value="浅色（Sand）" />
                <Row label="强调色" value="#599CE7" mono />
                <Row label="侧栏宽度" value="280px" />
              </SettingsBlock>
            )}
            {section === "notifications" && (
              <SettingsBlock title="通知" hint="桌面通知将在后续阶段接入。">
                <Row label="任务完成提醒" value="预留 · 关闭" />
                <Row label="未读对话角标" value="侧栏圆点 · 已启用" />
              </SettingsBlock>
            )}
            {section === "computer" && (
              <SettingsBlock title="电脑预览" hint="对话内可开关侧分屏预览云电脑画面。">
                <Row label="默认打开预览" value="关闭（按需打开）" />
                <Row label="画面刷新" value="约 500ms" />
              </SettingsBlock>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-between">
          <p className="text-[11px] text-muted-foreground">按 Esc 关闭</p>
          <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setSettingsOpen(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsBlock({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
      </div>
      <Separator />
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg border bg-card px-3 py-2.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right text-[13px] font-medium", mono && "font-mono text-[12px]")}>{value}</span>
    </div>
  );
}
