import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sidebar } from "@/features/navigation/Sidebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { useConversationsQuery, useBotsQuery } from "@/features/workspace/useWorkspace";
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUiStore
} from "@/stores/ui-store";

function hasSettingsQuery(searchStr: string): boolean {
  const raw = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  return new URLSearchParams(raw).get("settings") === "1";
}

/**
 * Grok `sand-sidebar-resize-handle`:
 * absolute, full height, 12px hit area, inset-inline-end -6px, col-resize.
 */
function SidebarResizeHandle({
  width,
  onWidthChange,
  onWidthCommit
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidthRef = useRef(width);
  latestWidthRef.current = width;

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      dragRef.current = {
        startX: event.clientX,
        startWidth: width
      };
      latestWidthRef.current = width;
      document.body.dataset.sidebarResizing = "true";
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / some hosts lack pointer capture
      }
    },
    [width]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX));
      latestWidthRef.current = next;
      onWidthChange(next);
    },
    [onWidthChange]
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      delete document.body.dataset.sidebarResizing;
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // ignore
      }
      const next = clampSidebarWidth(latestWidthRef.current);
      onWidthChange(next);
      onWidthCommit(next);
    },
    [onWidthChange, onWidthCommit]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      className="sand-sidebar-resize-handle app-region-no-drag absolute top-0 bottom-0 z-20 w-3 cursor-col-resize touch-none bg-transparent max-[700px]:hidden"
      style={{ insetInlineEnd: -6 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const botsQuery = useBotsQuery();
  const conversationsQuery = useConversationsQuery();
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const storedWidth = useUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  const [liveWidth, setLiveWidth] = useState(storedWidth);

  useEffect(() => {
    setLiveWidth(storedWidth);
  }, [storedWidth]);

  useEffect(() => {
    return () => {
      delete document.body.dataset.sidebarResizing;
    };
  }, []);

  const bots = botsQuery.data ?? [];
  const conversations = conversationsQuery.data ?? [];
  const selectedConversationId = pathname.startsWith("/c/") ? pathname.slice(3) : undefined;
  const bootError =
    botsQuery.isError || conversationsQuery.isError
      ? ((botsQuery.error ?? conversationsQuery.error) as Error)?.message ?? "无法连接 API（请先 docker compose up -d）"
      : undefined;

  useEffect(() => {
    if (!hasSettingsQuery(searchStr)) return;
    setSettingsOpen(true);
  }, [searchStr, setSettingsOpen]);

  const shellStyle = {
    "--sand-sidebar-width": `${liveWidth}px`
  } as CSSProperties;

  return (
    <main
      className="grid h-dvh min-h-0 grid-cols-[var(--sand-sidebar-width)_minmax(0,1fr)] overflow-hidden bg-background text-foreground max-[700px]:grid-cols-[72px_minmax(0,1fr)]"
      style={shellStyle}
    >
      <div className="relative min-h-0 min-w-0">
        <Sidebar
          bots={bots}
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onNewChat={() => void navigate({ to: "/new" })}
          onSelectConversation={(conversation) =>
            void navigate({ to: "/c/$conversationId", params: { conversationId: conversation.id } })
          }
          onOpenManage={(path) => void navigate({ to: path })}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SidebarResizeHandle width={liveWidth} onWidthChange={setLiveWidth} onWidthCommit={setSidebarWidth} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col bg-background">
        {bootError ? (
          <section className="m-auto flex max-w-md flex-col items-center gap-3 px-6 text-center">
            <h1 className="text-[1.2rem] font-semibold tracking-tight">后端未连接</h1>
            <p className="text-[14px] leading-relaxed text-muted-foreground">{bootError}</p>
            <p className="text-[12px] text-muted-foreground">在仓库根目录执行：docker compose up -d</p>
          </section>
        ) : (
          <Outlet />
        )}
      </div>
      <SettingsDialog />
    </main>
  );
}
