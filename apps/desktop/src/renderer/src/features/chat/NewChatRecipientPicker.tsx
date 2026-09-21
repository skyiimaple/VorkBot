import type { Bot } from "@vork/contracts";
import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function resolveCreateBotName(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed : "新建 Bot";
}

export function NewChatRecipientPicker({
  bots,
  onCreateBot,
  onSelectBot,
  onCancel
}: {
  bots: Bot[];
  onCreateBot: (name: string) => Promise<void>;
  onSelectBot: (bot: Bot) => Promise<void>;
  onCancel?: () => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string>();

  const shownBots = useMemo(
    () => bots.filter((bot) => bot.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    [bots, query]
  );

  const createLabel = query.trim() ? `创建名为“${query.trim()}”的 Bot` : "创建新 Bot";
  const options = useMemo(
    () => [{ kind: "create" as const }, ...shownBots.map((bot) => ({ kind: "bot" as const, bot }))],
    [shownBots]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  async function choose(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请确认后端已启动");
    } finally {
      setBusy(false);
    }
  }

  async function activate(index: number) {
    const option = options[index];
    if (!option) return;
    if (option.kind === "create") {
      await choose(() => onCreateBot(resolveCreateBotName(query)));
      return;
    }
    await choose(() => onSelectBot(option.bot));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel?.();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void activate(highlight);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" aria-label="新聊天收件人">
      <div className="app-region-drag border-b border-border/80 bg-card/80 px-5 py-3 backdrop-blur-sm sm:px-7">
        <div className="app-region-no-drag flex w-full items-center gap-3">
          <label htmlFor="recipient-search" className="shrink-0 text-[13px] font-medium text-muted-foreground">
            收件人<span aria-hidden>：</span>
          </label>
          <Input
            ref={inputRef}
            id="recipient-search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[highlight] ? `${listId}-opt-${highlight}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索或创建 Bot"
            className="h-9 flex-1 rounded-xl border-transparent bg-muted/60 shadow-none focus-visible:border-border focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-primary/15"
          />
        </div>
        {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4 sm:px-7">
          <div id={listId} role="listbox" aria-label="收件人选项" className="grid w-full gap-0.5">
            <Button
              id={`${listId}-opt-0`}
              type="button"
              variant="ghost"
              role="option"
              aria-label="创建新 Bot"
              aria-selected={highlight === 0}
              disabled={busy}
              onMouseEnter={() => setHighlight(0)}
              onClick={() => void activate(0)}
              className={cn(
                "h-auto justify-start gap-3 rounded-xl px-3 py-2.5",
                highlight === 0 && "bg-primary-soft ring-1 ring-primary/20 hover:bg-primary-soft-hover"
              )}
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-foreground text-background">
                  <Plus className="size-4" />
                </AvatarFallback>
              </Avatar>
              <span aria-hidden className="min-w-0 text-left">
                <span className="block text-[14px] font-medium">{createLabel}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {query.trim() ? "使用输入名称创建临时 Bot" : "输入名字以创建 Bot"}
                </span>
              </span>
            </Button>

            {shownBots.map((bot, index) => {
              const optionIndex = index + 1;
              const active = highlight === optionIndex;
              return (
                <Button
                  id={`${listId}-opt-${optionIndex}`}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-label={bot.name}
                  aria-selected={active}
                  disabled={busy}
                  key={bot.id}
                  onMouseEnter={() => setHighlight(optionIndex)}
                  onClick={() => void activate(optionIndex)}
                  className={cn(
                    "h-auto justify-start gap-3 rounded-xl px-3 py-2.5",
                    active && "bg-accent ring-1 ring-border/80"
                  )}
                >
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-muted text-[12px] font-semibold text-muted-foreground">
                      {bot.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span aria-hidden className="min-w-0 text-left">
                    <span className="block truncate text-[14px]">{bot.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{bot.persona || "已有 Bot"}</span>
                  </span>
                </Button>
              );
            })}

            {shownBots.length === 0 && query.trim() ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">没有匹配的 Bot，可直接创建新 Bot</p>
            ) : null}

            {shownBots.length === 0 && !query.trim() && bots.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">还没有 Bot — 点上方创建即可开始</p>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}
