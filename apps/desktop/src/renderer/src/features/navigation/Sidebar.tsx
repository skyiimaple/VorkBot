import type { Bot, Conversation } from "@vork/contracts";
import {
  Bell,
  BellOff,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

/**
 * Grok `sand-agents-section__header` (gx):
 * - 30px row, px-8 / pt-8 / pb-6, radius 6
 * - label: 12px secondary, normal weight (not medium / tracking-wide)
 * - count only when collapsed; on hover count fades, chevron-right fades in
 * - chevron always chevron-right; expanded → rotate(90deg)
 */
function SectionHeaderButton({
  label,
  count,
  collapsed,
  locked,
  onClick,
  className,
  ...props
}: {
  label: string;
  count: number;
  collapsed: boolean;
  /** Synthetic default section (未分组): no grab cursor, same fold chrome */
  locked?: boolean;
  onClick: () => void;
  className?: string;
} & Omit<ComponentProps<"button">, "onClick" | "children" | "type" | "className">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={!collapsed}
      data-collapsed={collapsed ? "true" : "false"}
      data-locked={locked ? "true" : undefined}
      className={cn(
        "group/section sand-agents-section__header mb-0.5 flex h-[30px] w-full box-border cursor-pointer items-center gap-0 rounded-[6px] border-0 bg-transparent px-2 pt-2 pb-1.5 text-left",
        "hover:bg-[color:var(--sand-fill-ghost-hover)]",
        "max-[700px]:justify-center",
        locked && "mt-1.5",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-normal leading-none text-[color:var(--sand-text-secondary)] max-[700px]:hidden">
        {label}
      </span>
      <span className="relative inline-flex h-4 min-w-4 shrink-0 items-center justify-end max-[700px]:hidden">
        {collapsed ? (
          <span className="tabular-nums text-[12px] leading-none text-[color:var(--sand-text-secondary)] opacity-100 transition-opacity duration-[120ms] ease-out group-hover/section:opacity-0">
            {count}
          </span>
        ) : null}
        <span
          aria-hidden
          className={cn(
            "absolute end-0 inline-flex size-4 items-center justify-center text-[color:var(--sand-text-secondary)]",
            "opacity-0 transition-opacity duration-[120ms] ease-out group-hover/section:opacity-100",
            collapsed ? "rotate-0" : "rotate-90"
          )}
        >
          <ChevronRight className="size-3.5" strokeWidth={2} />
        </span>
      </span>
    </button>
  );
}

const manageItems = [
  { label: "任务队列", path: "/tasks" as const },
  { label: "Skills", path: "/skills" as const },
  { label: "文件", path: "/files" as const },
  { label: "模型凭据", path: "/credentials" as const }
];

type Row = { conversation: Conversation; bot: Bot; displayName: string };

type PromptState =
  | { kind: "rename-bot"; botId: string; value: string }
  | { kind: "rename-section"; sectionId: string; value: string }
  | { kind: "new-section"; botId?: string; value: string }
  | null;

export function Sidebar({
  bots,
  conversations,
  selectedConversationId,
  onNewChat,
  onSelectConversation,
  onOpenManage,
  onOpenSettings
}: {
  bots: Bot[];
  conversations: Conversation[];
  selectedConversationId?: string;
  onNewChat: () => void;
  onSelectConversation: (conversation: Conversation) => void;
  onOpenManage: (path: "/tasks" | "/skills" | "/files" | "/credentials") => void;
  onOpenSettings: () => void;
}) {
  const query = useUiStore((state) => state.sidebarQuery);
  const setQuery = useUiStore((state) => state.setSidebarQuery);
  const hiddenBotIds = useUiStore((state) => state.hiddenBotIds);
  const showHiddenBots = useUiStore((state) => state.showHiddenBots);
  const setShowHiddenBots = useUiStore((state) => state.setShowHiddenBots);
  const pinnedBotIds = useUiStore((state) => state.pinnedBotIds);
  const mutedBotIds = useUiStore((state) => state.mutedBotIds);
  const sections = useUiStore((state) => state.sections);
  const botNameOverrides = useUiStore((state) => state.botNameOverrides);
  const unreadConversationIds = useUiStore((state) => state.unreadConversationIds);
  const lastSeenByConversation = useUiStore((state) => state.lastSeenByConversation);
  const markConversationSeen = useUiStore((state) => state.markConversationSeen);
  const hideBot = useUiStore((state) => state.hideBot);
  const unhideBot = useUiStore((state) => state.unhideBot);
  const pinBot = useUiStore((state) => state.pinBot);
  const unpinBot = useUiStore((state) => state.unpinBot);
  const muteBot = useUiStore((state) => state.muteBot);
  const unmuteBot = useUiStore((state) => state.unmuteBot);
  const markConversationUnread = useUiStore((state) => state.markConversationUnread);
  const markConversationRead = useUiStore((state) => state.markConversationRead);
  const renameBot = useUiStore((state) => state.renameBot);
  const createSection = useUiStore((state) => state.createSection);
  const renameSection = useUiStore((state) => state.renameSection);
  const deleteSection = useUiStore((state) => state.deleteSection);
  const toggleSectionCollapsed = useUiStore((state) => state.toggleSectionCollapsed);
  const ungroupedCollapsed = useUiStore((state) => state.ungroupedCollapsed);
  const toggleUngroupedCollapsed = useUiStore((state) => state.toggleUngroupedCollapsed);
  const moveBotToSection = useUiStore((state) => state.moveBotToSection);
  const moveSection = useUiStore((state) => state.moveSection);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  const [prompt, setPrompt] = useState<PromptState>(null);

  useEffect(() => {
    if (!selectedConversationId) return;
    const conversation = conversations.find((item) => item.id === selectedConversationId);
    if (conversation) markConversationSeen(conversation.id, conversation.updatedAt);
  }, [conversations, markConversationSeen, selectedConversationId]);

  const needle = query.trim().toLocaleLowerCase();

  const rows = useMemo(() => {
    return conversations.flatMap((conversation) => {
      const bot = bots.find((item) => item.id === conversation.botId);
      if (!bot) return [];
      const displayName = botNameOverrides[bot.id]?.trim() || bot.name;
      if (needle && !displayName.toLocaleLowerCase().includes(needle)) return [];
      return [{ conversation, bot, displayName } satisfies Row];
    });
  }, [bots, botNameOverrides, conversations, needle]);

  const sectionBotIds = useMemo(() => new Set(sections.flatMap((section) => section.botIds)), [sections]);

  const pinned = rows.filter(
    ({ bot }) => pinnedBotIds.includes(bot.id) && !hiddenBotIds.includes(bot.id)
  );
  const hidden = rows.filter(({ bot }) => hiddenBotIds.includes(bot.id));
  const sectionRows = sections.map((section) => ({
    section,
    items: rows.filter(({ bot }) => section.botIds.includes(bot.id) && !hiddenBotIds.includes(bot.id))
  }));
  const ungrouped = rows.filter(
    ({ bot }) =>
      !hiddenBotIds.includes(bot.id) &&
      !pinnedBotIds.includes(bot.id) &&
      !sectionBotIds.has(bot.id)
  );

  function isUnread(row: Row): boolean {
    if (row.conversation.id === selectedConversationId) return false;
    if (unreadConversationIds.includes(row.conversation.id)) return true;
    const lastSeen = lastSeenByConversation[row.conversation.id];
    if (!lastSeen) return false;
    return row.conversation.updatedAt > lastSeen;
  }

  function submitPrompt() {
    if (!prompt) return;
    if (prompt.kind === "rename-bot") renameBot(prompt.botId, prompt.value);
    if (prompt.kind === "rename-section") renameSection(prompt.sectionId, prompt.value);
    if (prompt.kind === "new-section") createSection(prompt.value, prompt.botId);
    setPrompt(null);
  }

  return (
    <aside
      className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 w-full flex-col border-r border-sidebar-border"
    >
      {/* Grok sand-agents-sidebar__header: traffic-light zone (left empty) + single + right */}
      <div className="sand-agents-sidebar__header app-region-drag flex h-[var(--sand-titlebar-block)] shrink-0 items-center justify-end gap-2 px-4 pt-0 pb-0 max-[700px]:justify-center max-[700px]:px-1">
        <div className="sand-agents-sidebar__new-actions app-region-no-drag ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="新建聊天"
            title="新建聊天"
            onClick={onNewChat}
            className="size-6 shrink-0 rounded-[6px] text-[color:var(--sand-text-secondary)] shadow-none hover:bg-[color:var(--sand-fill-ghost-hover)] hover:text-[color:var(--sand-text-primary)]"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* Grok sand-agents-sidebar__search: 32px field, fill-secondary, inset hairline, mx-12 */}
      <div className="sand-agents-sidebar__search relative mx-3 my-1 max-[700px]:mx-1.5">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[color:var(--sand-text-tertiary)] max-[700px]:hidden"
          aria-hidden
        />
        <Input
          aria-label="搜索"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索"
          className="h-8 rounded-lg border-0 bg-[color:var(--sand-fill-secondary)] pl-8 text-[14px] leading-5 text-foreground shadow-[inset_0_0_0_0.5px_var(--sand-border-weak)] placeholder:text-[color:var(--sand-text-tertiary)] focus-visible:bg-[color:var(--sand-fill-secondary-hover)] focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_0.5px_var(--sand-border-weak)] hover:bg-[color:var(--sand-fill-secondary-hover)] max-[700px]:px-1.5 max-[700px]:pl-1.5 max-[700px]:text-center"
        />
      </div>

      <ScrollArea className="scrollbar-grok min-h-0 flex-1 px-1">
        <nav aria-label="Bot 对话" className="flex flex-col gap-0.5 pr-0.5 pb-2">
          {pinned.length > 0 && (
            <ConversationGroup
              title="已置顶的 Bot"
              emptyLabel=""
              items={pinned}
              selectedConversationId={selectedConversationId}
              isUnread={isUnread}
              mutedBotIds={mutedBotIds}
              sections={sections}
              onSelect={onSelectConversation}
              onRename={(row) => setPrompt({ kind: "rename-bot", botId: row.bot.id, value: row.displayName })}
              onPin={(row) => unpinBot(row.bot.id)}
              pinLabel="取消置顶"
              onMute={(row) => (mutedBotIds.includes(row.bot.id) ? unmuteBot(row.bot.id) : muteBot(row.bot.id))}
              onHide={(row) => hideBot(row.bot.id)}
              onMarkUnread={(row) => markConversationUnread(row.conversation.id)}
              onMarkRead={(row) => markConversationRead(row.conversation.id)}
              onMoveToSection={(row, sectionId) => moveBotToSection(row.bot.id, sectionId)}
              onNewSection={(row) => setPrompt({ kind: "new-section", botId: row.bot.id, value: "新分组" })}
              onOpenBotSettings={() => setSettingsOpen(true)}
              hideAction="hide"
            />
          )}

          {sectionRows.map(({ section, items }, index) => (
            <div key={section.id} className="mt-1.5" data-section-id={section.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <SectionHeaderButton
                    label={section.name}
                    count={items.length}
                    collapsed={section.collapsed}
                    onClick={() => toggleSectionCollapsed(section.id)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuLabel>分组操作</ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => setPrompt({ kind: "rename-section", sectionId: section.id, value: section.name })}
                  >
                    重命名分组
                  </ContextMenuItem>
                  <ContextMenuItem disabled={index === 0} onSelect={() => moveSection(section.id, "up")}>
                    上移
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index === sections.length - 1}
                    onSelect={() => moveSection(section.id, "down")}
                  >
                    下移
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => deleteSection(section.id)}>
                    删除分组
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {!section.collapsed && (
                <ConversationGroup
                  title=""
                  emptyLabel={needle ? "无匹配结果" : "空分组"}
                  items={items}
                  selectedConversationId={selectedConversationId}
                  isUnread={isUnread}
                  mutedBotIds={mutedBotIds}
                  sections={sections}
                  onSelect={onSelectConversation}
                  onRename={(row) => setPrompt({ kind: "rename-bot", botId: row.bot.id, value: row.displayName })}
                  onPin={(row) => pinBot(row.bot.id)}
                  pinLabel="置顶"
                  onMute={(row) => (mutedBotIds.includes(row.bot.id) ? unmuteBot(row.bot.id) : muteBot(row.bot.id))}
                  onHide={(row) => hideBot(row.bot.id)}
                  onMarkUnread={(row) => markConversationUnread(row.conversation.id)}
                  onMarkRead={(row) => markConversationRead(row.conversation.id)}
                  onMoveToSection={(row, sectionId) => moveBotToSection(row.bot.id, sectionId)}
                  onNewSection={(row) => setPrompt({ kind: "new-section", botId: row.bot.id, value: "新分组" })}
                  onOpenBotSettings={() => setSettingsOpen(true)}
                  hideAction="hide"
                />
              )}
            </div>
          ))}

          <div className="mt-0" data-section-id="__ungrouped__">
            <SectionHeaderButton
              label="未分组"
              count={ungrouped.length}
              collapsed={ungroupedCollapsed}
              locked
              onClick={() => toggleUngroupedCollapsed()}
            />
            {!ungroupedCollapsed && (
              <ConversationGroup
                title=""
                emptyLabel={needle ? "无匹配结果" : "还没有 Bot"}
                items={ungrouped}
                selectedConversationId={selectedConversationId}
                isUnread={isUnread}
                mutedBotIds={mutedBotIds}
                sections={sections}
                onSelect={onSelectConversation}
                onRename={(row) => setPrompt({ kind: "rename-bot", botId: row.bot.id, value: row.displayName })}
                onPin={(row) => pinBot(row.bot.id)}
                pinLabel="置顶"
                onMute={(row) => (mutedBotIds.includes(row.bot.id) ? unmuteBot(row.bot.id) : muteBot(row.bot.id))}
                onHide={(row) => hideBot(row.bot.id)}
                onMarkUnread={(row) => markConversationUnread(row.conversation.id)}
                onMarkRead={(row) => markConversationRead(row.conversation.id)}
                onMoveToSection={(row, sectionId) => moveBotToSection(row.bot.id, sectionId)}
                onNewSection={(row) => setPrompt({ kind: "new-section", botId: row.bot.id, value: "新分组" })}
                onOpenBotSettings={() => setSettingsOpen(true)}
                hideAction="hide"
              />
            )}
          </div>

          {hidden.length > 0 && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setShowHiddenBots(!showHiddenBots)}
                className="group/section mb-0.5 flex h-[30px] w-full items-center justify-between rounded-[6px] px-2 pt-2 pb-1.5 text-[12px] font-normal text-[color:var(--sand-text-secondary)] hover:bg-[color:var(--sand-fill-ghost-hover)] max-[700px]:justify-center"
              >
                <span className="max-[700px]:hidden">已隐藏的 Bot</span>
                <span className="inline-flex items-center gap-1 max-[700px]:hidden">
                  <span className="tabular-nums">{hidden.length}</span>
                  {showHiddenBots ? <EyeOff className="size-3.5 opacity-70" aria-hidden /> : <Eye className="size-3.5 opacity-70" aria-hidden />}
                </span>
              </button>
              {showHiddenBots && (
                <ConversationGroup
                  title=""
                  emptyLabel=""
                  items={hidden}
                  selectedConversationId={selectedConversationId}
                  isUnread={isUnread}
                  mutedBotIds={mutedBotIds}
                  sections={sections}
                  onSelect={onSelectConversation}
                  onRename={(row) => setPrompt({ kind: "rename-bot", botId: row.bot.id, value: row.displayName })}
                  onPin={(row) => {
                    unhideBot(row.bot.id);
                    pinBot(row.bot.id);
                  }}
                  pinLabel="置顶"
                  onMute={(row) => (mutedBotIds.includes(row.bot.id) ? unmuteBot(row.bot.id) : muteBot(row.bot.id))}
                  onHide={(row) => unhideBot(row.bot.id)}
                  onMarkUnread={(row) => markConversationUnread(row.conversation.id)}
                  onMarkRead={(row) => markConversationRead(row.conversation.id)}
                  onMoveToSection={(row, sectionId) => {
                    unhideBot(row.bot.id);
                    moveBotToSection(row.bot.id, sectionId);
                  }}
                  onNewSection={(row) => {
                    unhideBot(row.bot.id);
                    setPrompt({ kind: "new-section", botId: row.bot.id, value: "新分组" });
                  }}
                  onOpenBotSettings={() => setSettingsOpen(true)}
                  hideAction="unhide"
                />
              )}
            </div>
          )}
        </nav>
      </ScrollArea>

      <div className="sand-agents-sidebar__footer shrink-0 border-t border-[color:var(--sand-border-subtle)] px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="sand-agents-sidebar__account h-9 w-full justify-start gap-2 rounded-[6px] px-2 py-1.5 text-[color:var(--sand-text-secondary)] shadow-none hover:bg-[color:var(--sand-fill-ghost-hover)] hover:text-foreground max-[700px]:justify-center"
            >
              <Avatar className="size-6">
                <AvatarFallback className="bg-[color:var(--sand-fill-secondary)] text-[10px] font-semibold text-[color:var(--sand-text-secondary)]">
                  本
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium max-[700px]:hidden">
                本地用户
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52" aria-label="用户菜单">
            <DropdownMenuLabel>管理</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {manageItems.map((item) => (
              <DropdownMenuItem key={item.path} onSelect={() => onOpenManage(item.path)}>
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>系统设置</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={prompt !== null} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {prompt?.kind === "rename-bot"
                ? "重命名 Bot"
                : prompt?.kind === "rename-section"
                  ? "重命名分组"
                  : "新建分组"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={prompt?.value ?? ""}
            onChange={(event) => prompt && setPrompt({ ...prompt, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitPrompt();
              }
            }}
            aria-label="名称"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPrompt(null)}>
              取消
            </Button>
            <Button type="button" onClick={submitPrompt}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ConversationGroup({
  title,
  emptyLabel,
  items,
  selectedConversationId,
  isUnread,
  mutedBotIds,
  sections,
  onSelect,
  onRename,
  onPin,
  pinLabel,
  onMute,
  onHide,
  onMarkUnread,
  onMarkRead,
  onMoveToSection,
  onNewSection,
  onOpenBotSettings,
  hideAction
}: {
  title: string;
  emptyLabel: string;
  items: Row[];
  selectedConversationId?: string;
  isUnread: (row: Row) => boolean;
  mutedBotIds: string[];
  sections: Array<{ id: string; name: string }>;
  onSelect: (conversation: Conversation) => void;
  onRename: (row: Row) => void;
  onPin: (row: Row) => void;
  pinLabel: string;
  onMute: (row: Row) => void;
  onHide: (row: Row) => void;
  onMarkUnread: (row: Row) => void;
  onMarkRead: (row: Row) => void;
  onMoveToSection: (row: Row, sectionId: string | null) => void;
  onNewSection: (row: Row) => void;
  onOpenBotSettings: () => void;
  hideAction: "hide" | "unhide";
}) {
  if (!title && items.length === 0 && !emptyLabel) return null;

  return (
    <div className="flex flex-col gap-px">
      {title ? (
        <p className="px-2 pt-2 pb-1 text-[12px] font-normal leading-none text-[color:var(--sand-text-secondary)] max-[700px]:hidden">
          {title}
        </p>
      ) : null}
      {items.length === 0 ? (
        emptyLabel ? (
          <p className="px-2 py-2 text-[12px] text-muted-foreground max-[700px]:hidden">{emptyLabel}</p>
        ) : null
      ) : (
        items.map((row) => {
          const selected = row.conversation.id === selectedConversationId;
          const unread = isUnread(row);
          const muted = mutedBotIds.includes(row.bot.id);
          return (
            <ContextMenu key={row.conversation.id}>
              <ContextMenuTrigger asChild>
                <div className="group relative flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={row.displayName}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelect(row.conversation)}
                    className={cn(
                      "h-auto flex-1 justify-start gap-2.5 rounded-lg px-2 py-1.5 max-[700px]:justify-center",
                      selected
                        ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                        : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    )}
                  >
                    <span className="relative">
                      <Avatar className="size-6">
                        <AvatarFallback
                          aria-hidden
                          className={cn(
                            "text-[10px] font-semibold",
                            selected
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {initials(row.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      {unread && (
                        <span
                          aria-label="未读"
                          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
                        />
                      )}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-[13px] max-[700px]:hidden",
                        selected && "font-medium text-foreground",
                        unread && !selected && "font-medium text-foreground"
                      )}
                    >
                      {row.displayName}
                    </span>
                    {muted && <BellOff className="size-3 opacity-60 max-[700px]:hidden" aria-label="已静音" />}
                  </Button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52" aria-label={`${row.displayName} 菜单`}>
                <ContextMenuItem onSelect={() => onRename(row)}>重命名 Bot</ContextMenuItem>
                <ContextMenuItem onSelect={() => onPin(row)}>
                  {pinLabel === "置顶" ? (
                    <span className="flex items-center gap-2">
                      <Pin className="size-3.5" /> 置顶
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <PinOff className="size-3.5" /> 取消置顶
                    </span>
                  )}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onMute(row)}>
                  {muted ? (
                    <span className="flex items-center gap-2">
                      <Bell className="size-3.5" /> 取消静音
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <BellOff className="size-3.5" /> 静音
                    </span>
                  )}
                </ContextMenuItem>
                <ContextMenuSeparator />
                {unread ? (
                  <ContextMenuItem onSelect={() => onMarkRead(row)}>标为已读</ContextMenuItem>
                ) : (
                  <ContextMenuItem onSelect={() => onMarkUnread(row)}>标为未读</ContextMenuItem>
                )}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>移至分组</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-44">
                    <ContextMenuItem onSelect={() => onMoveToSection(row, null)}>未分组</ContextMenuItem>
                    {sections.map((section) => (
                      <ContextMenuItem key={section.id} onSelect={() => onMoveToSection(row, section.id)}>
                        {section.name}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onNewSection(row)}>移至新分组</ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onOpenBotSettings()}>
                  <span className="flex items-center gap-2">
                    <Settings2 className="size-3.5" /> Bot 设置
                  </span>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    void navigator.clipboard?.writeText(row.conversation.id);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Copy className="size-3.5" /> 复制对话 ID
                  </span>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onHide(row)}>
                  {hideAction === "hide" ? (
                    <span className="flex items-center gap-2">
                      <EyeOff className="size-3.5" /> 从侧边栏隐藏
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Eye className="size-3.5" /> 取消隐藏
                    </span>
                  )}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled title="后端硬删尚未接入">
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-3.5" /> 删除（未接入）
                  </span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })
      )}
    </div>
  );
}
