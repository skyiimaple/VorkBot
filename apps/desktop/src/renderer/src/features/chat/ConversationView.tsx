import type { Task } from "@vork/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, LoaderCircle, Monitor, MoreHorizontal, Pause, Play, Settings2, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { workspaceKeys, useDeleteConversationMutation } from "../workspace/useWorkspace.js";
import { ComputerPanel } from "../computer/ComputerPanel.js";
import { AssistantMessageBody } from "./AssistantMessageBody.js";
import { MessageComposer } from "./MessageComposer.js";
import { TaskControlCard } from "./TaskControlCard.js";
import { useConversation } from "./useConversation.js";
import { useStickToBottom } from "./useStickToBottom.js";

/** 对齐 Grok 文案键 AUV+TY：「思考中」（无省略号、无第二套轮换文案）。 */
const THINKING_PHRASES = ["思考中"] as const;
const SIDE_COMPUTER_MEDIA_QUERY = "(min-width: 640px)";

function useSideComputerLayout(): boolean {
  const [sideLayout, setSideLayout] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia(SIDE_COMPUTER_MEDIA_QUERY).matches : true
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(SIDE_COMPUTER_MEDIA_QUERY);
    const updateLayout = () => setSideLayout(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);
    return () => mediaQuery.removeEventListener("change", updateLayout);
  }, []);

  return sideLayout;
}

function thinkingPhraseForTask(taskId: string | undefined): string {
  if (!taskId) return THINKING_PHRASES[0];
  let hash = 0;
  for (let i = 0; i < taskId.length; i += 1) {
    hash = (hash + taskId.charCodeAt(i) * (i + 1)) % THINKING_PHRASES.length;
  }
  return THINKING_PHRASES[hash] ?? THINKING_PHRASES[0];
}

function headerStatusLabel(connectionState: string, activeTask: Task | undefined, thinkingLabel: string): string {
  if (connectionState === "loading") return "加载中…";
  if (!activeTask) return "对话中";
  switch (activeTask.status) {
    case "queued":
    case "running":
      return activeTask.pauseRequestedAt ? "正在暂停" : thinkingLabel;
    case "paused":
      return "已暂停";
    case "waiting_approval":
      return "等待审批";
    case "uncertain":
      return "结果待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "对话中";
  }
}

export function ConversationView({ conversationId, botName }: { conversationId: string; botName: string }) {
  const { messages, activeTask, controlState, activeSlotId, connectionState, sendMessage, cancelActiveTask,
    pauseActiveTask, resumeActiveTask, resolveApproval, resolveUncertain, isControlPending, working, api } =
    useConversation(conversationId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const computerOpen = useUiStore((state) => state.computerOpenByConversation[conversationId] ?? false);
  const toggleComputerOpen = useUiStore((state) => state.toggleComputerOpen);
  const setComputerOpen = useUiStore((state) => state.setComputerOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { showJumpToLatest, onContentGrow, forceStick, jumpToLatest } = useStickToBottom(viewportRef);
  const deleteConversation = useDeleteConversationMutation();
  const sideComputerLayout = useSideComputerLayout();

  const thinkingLabel = useMemo(() => thinkingPhraseForTask(activeTask?.id), [activeTask?.id]);

  useEffect(() => {
    forceStick();
  }, [conversationId, forceStick]);

  // 列表结构变化时贴底；打字机增长通过 onDisplayChange 直接 scroll，避免为跟滚整树 setState。
  useEffect(() => {
    onContentGrow();
  }, [messages, activeTask?.status, activeSlotId, working, onContentGrow]);

  async function handleDeleteConversation() {
    if (!window.confirm(`永久删除「${botName}」的对话？此操作不可恢复。`)) return;
    try {
      await deleteConversation.mutateAsync(conversationId);
      setComputerOpen(conversationId, false);
      await navigate({ to: "/" });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除失败，请稍后重试");
    }
  }

  async function handleSend(content: string) {
    forceStick();
    const result = await sendMessage(content);
    if (result.kind === "assistant-created") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKeys.bots() }),
        queryClient.invalidateQueries({ queryKey: workspaceKeys.conversations() })
      ]);
      await navigate({
        to: "/c/$conversationId",
        params: { conversationId: result.result.conversationId }
      });
    }
  }

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const showStandaloneThinking =
    Boolean(working && activeTask) && (!lastMessage || lastMessage.authorType === "user");
  const lastMessageIsEmptyAssistant =
    lastMessage?.authorType === "assistant" && lastMessage.content.trim().length === 0;
  const showInlineThinking = Boolean(working && activeTask && lastMessageIsEmptyAssistant);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-busy={connectionState === "loading"}>
      <header className="app-region-drag flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/90 px-4 backdrop-blur-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-7 rounded-[8px]">
            <AvatarFallback className="rounded-[8px] bg-primary-soft text-[11px] font-semibold text-primary">
              {botName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold tracking-tight">{botName}</h1>
            {connectionState === "loading" || working ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {headerStatusLabel(connectionState, activeTask, thinkingLabel)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="header-actions app-region-no-drag flex items-center gap-0.5" aria-label="对话操作">
          {(activeTask?.status === "queued" || activeTask?.status === "running") && !activeTask.pauseRequestedAt ? (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="暂停任务" title="暂停任务" disabled={isControlPending} onClick={() => void pauseActiveTask()} className="size-8 rounded-lg text-muted-foreground">
              <Pause className="size-4" />
            </Button>
          ) : null}
          {activeTask?.status === "paused" ? (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="恢复任务" title="恢复任务" disabled={isControlPending} onClick={() => void resumeActiveTask()} className="size-8 rounded-lg text-muted-foreground">
              <Play className="size-4" />
            </Button>
          ) : null}
          {activeTask && ["queued", "running", "paused"].includes(activeTask.status) ? (
            <Button type="button" size="icon-sm" variant="ghost" aria-label="取消任务" title="取消任务" disabled={isControlPending} onClick={() => void cancelActiveTask()} className="size-8 rounded-lg text-muted-foreground">
              <Square className="size-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="电脑"
            aria-pressed={computerOpen}
            title="电脑"
            onClick={() => toggleComputerOpen(conversationId)}
            className={cn(
              "size-8 rounded-lg text-muted-foreground shadow-none hover:text-foreground",
              computerOpen && "bg-primary-soft text-primary hover:bg-primary-soft-hover hover:text-primary"
            )}
          >
            <Monitor className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="更多操作"
                title="更多操作"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings2 className="size-3.5" />
                Bot 设置
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(conversationId);
                }}
              >
                <Copy className="size-3.5" />
                复制对话 ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={deleteConversation.isPending}
                onSelect={() => {
                  void handleDeleteConversation();
                }}
              >
                <Trash2 className="size-3.5" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {/* 原生 overflow，避免 Radix ScrollArea 在 absolute 布局下裁切却滚不动 */}
            <div
              ref={viewportRef}
              className="messages scrollbar-grok absolute inset-0 overflow-x-hidden overflow-y-auto"
              aria-live="polite"
            >
              <div className="flex w-full flex-col gap-4 px-5 py-5 sm:px-7">
                {messages.length === 0 ? (
                  <div className="m-auto flex max-w-md flex-col items-center gap-2 py-20 text-center">
                    <Avatar className="mb-1 size-12">
                      <AvatarFallback className="bg-primary-soft text-[18px] font-semibold text-primary">
                        {botName.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-[16px] font-medium tracking-tight">开始使用 {botName}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      直接描述它的名称、职责与工作方式。也可说「帮我做一个翻译助手」自动新建专用 Bot。需要文件或浏览器演示时，发送对应标记即可。
                    </p>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const isLast = index === messages.length - 1;
                    if (message.authorType === "user") {
                      return (
                        <article className="message user group/msg flex justify-end" key={message.id}>
                          <div className="max-w-[min(72%,36rem)]">
                            <div className="rounded-[18px] bg-user-bubble px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground">
                              <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                            </div>
                            <MessageTimestamp iso={message.createdAt} align="end" />
                          </div>
                        </article>
                      );
                    }

                    return (
                      <article
                        className="message group/msg flex justify-start"
                        data-message-author="assistant"
                        key={message.id}
                      >
                        <div className="max-w-[min(92%,48rem)] min-w-0 flex-1">
                          {isLast && showInlineThinking && (
                            <ThinkingStatus label={thinkingLabel} className="mb-2" />
                          )}
                          {isLast && working && activeSlotId && (
                            <ComputerHint
                              className="mb-2"
                              onOpen={() => setComputerOpen(conversationId, true)}
                            />
                          )}
                          {(message.content.trim().length > 0 || !(isLast && working)) && (
                            <div
                              className="rounded-[18px] bg-agent-bubble px-3.5 py-2.5 text-[14px] leading-[1.65] text-foreground"
                              data-assistant-markdown="true"
                              data-assistant-animate={message.id.startsWith("stream-") ? "true" : "false"}
                            >
                              <AssistantMessageBody
                                content={message.content}
                                animate={message.id.startsWith("stream-")}
                                onDisplayChange={onContentGrow}
                              />
                            </div>
                          )}
                          <MessageTimestamp iso={message.createdAt} />
                        </div>
                      </article>
                    );
                  })
                )}

                {showStandaloneThinking && (
                  <article className="message flex justify-start">
                    <div className="flex min-h-6 max-w-[min(92%,48rem)] flex-col justify-center gap-1.5">
                      <ThinkingStatus label={thinkingLabel} />
                      {activeSlotId ? (
                        <ComputerHint onOpen={() => setComputerOpen(conversationId, true)} />
                      ) : null}
                    </div>
                  </article>
                )}
                {controlState && (activeTask?.status === "waiting_approval" || activeTask?.status === "uncertain") ? (
                  <TaskControlCard
                    controlState={controlState}
                    pending={isControlPending}
                    onApproval={(decision) => void resolveApproval(decision)}
                    onUncertain={(resolution) => void resolveUncertain(resolution)}
                  />
                ) : null}
                <div ref={bottomRef} aria-hidden className="h-px w-full shrink-0" />
              </div>
            </div>

            {showJumpToLatest ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={jumpToLatest}
                  className="pointer-events-auto h-8 gap-1 rounded-full border border-border/80 bg-card/95 px-3 text-[12px] font-medium shadow-md backdrop-blur-sm"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                  新消息
                </Button>
              </div>
            ) : null}
          </div>

          <div className="bg-gradient-to-t from-background from-55% via-background to-transparent px-4 pt-1 pb-4 sm:px-6">
            <MessageComposer
              botName={botName}
              onSend={handleSend}
              onStop={cancelActiveTask}
              working={Boolean(working)}
              disabled={connectionState !== "ready"}
            />
          </div>
        </div>

        {computerOpen && sideComputerLayout && (
          <div className="flex min-h-0 w-[min(42%,26rem)] shrink-0">
            <ComputerPanel
              api={api}
              taskId={activeTask?.id}
              slotId={activeSlotId}
              open={computerOpen}
              layout="side"
              onClose={() => setComputerOpen(conversationId, false)}
            />
          </div>
        )}
      </div>

      {computerOpen && !sideComputerLayout && (
        <div className="border-t border-border">
          <ComputerPanel
            api={api}
            taskId={activeTask?.id}
            slotId={activeSlotId}
            open={computerOpen}
            layout="inline"
            onClose={() => setComputerOpen(conversationId, false)}
          />
        </div>
      )}
    </section>
  );
}

/** 默认隐藏绝对时分；hover 消息时才显示（对齐 Grok）。 */
function MessageTimestamp({ iso, align = "start" }: { iso: string; align?: "start" | "end" }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const label = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <p
      className={cn(
        "mt-1 text-[10px] text-muted-foreground/80 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100",
        align === "end" ? "pr-1 text-right" : ""
      )}
      title={date.toLocaleString()}
    >
      {label}
    </p>
  );
}

function ThinkingStatus({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-6 w-fit items-center gap-1.5 text-[13px] text-muted-foreground",
        className
      )}
      role="status"
    >
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary/80" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** 槽位就绪后的轻量入口；分配过程中不展示，避免暴露实现细节。 */
function ComputerHint({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex h-7 w-fit items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        className
      )}
    >
      <Monitor className="size-3.5" aria-hidden />
      查看电脑画面
    </button>
  );
}
