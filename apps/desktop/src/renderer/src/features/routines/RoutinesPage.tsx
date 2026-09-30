import type { Bot, CreateRoutineInput, Routine } from "@vork/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useVorkApi } from "@/features/chat/useConversation";
import { useBotsQuery, workspaceKeys } from "@/features/workspace/useWorkspace";
import { ManagePage } from "@/routes/ManagePages";
import { RoutineRuns } from "./RoutineRuns";

const key = ["routines"] as const;

export function RoutinesPage() {
  const api = useVorkApi();
  const navigate = useNavigate();
  const client = useQueryClient();
  const bots = useBotsQuery().data ?? [];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [historyRoutine, setHistoryRoutine] = useState<Routine | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const routines = useQuery({
    queryKey: key,
    queryFn: async () => {
      const response = await api.request({ operation: "listRoutines", input: {} });
      if (response.operation !== "listRoutines") throw new Error("Unexpected response");
      return response.data.routines;
    }
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const action = useMutation({
    mutationFn: async ({ routine, operation }: { routine: Routine; operation: "pauseRoutine" | "enableRoutine" | "runRoutineNow" | "deleteRoutine" }) =>
      api.request({ operation, input: { routineId: routine.id } }),
    onSuccess: refresh,
    onError: () => setError("操作失败；任务可能正在运行，请稍后重试。")
  });

  return (
    <ManagePage title="定时任务" description="按计划让 Bot 在固定专属对话中执行任务。" path="/routines">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">{routines.data?.length ?? 0} 个任务</p>
        <Button size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => setOpen(true)}><Plus className="size-3.5" />新建</Button>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      {!routines.data?.length ? (
        <div className="rounded-2xl border border-dashed bg-card/60 px-5 py-12 text-center text-[13px] text-muted-foreground">还没有定时任务。</div>
      ) : (
        <ul className="space-y-2">
          {routines.data.map((routine) => (
            <li key={routine.id} className="rounded-2xl border bg-card p-4 shadow-panel">
              <div className="flex items-start gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-muted"><CalendarClock className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><h2 className="truncate text-[13px] font-medium">{routine.name}</h2><Badge variant="secondary">{routine.status === "active" ? "运行中" : "已暂停"}</Badge></div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{describeSchedule(routine)} · {routine.timezone}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{routine.prompt}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/c/$conversationId", params: { conversationId: routine.conversationId } })}>打开对话</Button>
                <Button variant="ghost" size="sm" onClick={() => setHistoryRoutine(routine)}>历史</Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditingRoutine(routine); setOpen(true); }}><Pencil className="size-3.5" />编辑</Button>
                <Button variant="outline" size="sm" disabled={action.isPending && action.variables?.routine.id === routine.id} onClick={() => action.mutate({ routine, operation: "runRoutineNow" })}><Play className="size-3.5" />立即运行</Button>
                <Button variant="outline" size="sm" disabled={action.isPending && action.variables?.routine.id === routine.id} onClick={() => action.mutate({ routine, operation: routine.status === "active" ? "pauseRoutine" : "enableRoutine" })}>{routine.status === "active" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{routine.status === "active" ? "暂停" : "启用"}</Button>
                <Button variant="ghost" size="sm" className="text-destructive" disabled={action.isPending && action.variables?.routine.id === routine.id} onClick={() => window.confirm("删除定时任务？专属对话和历史会保留。") && action.mutate({ routine, operation: "deleteRoutine" })}><Trash2 className="size-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <RoutineDialog open={open} bots={bots} routine={editingRoutine} onOpenChange={(next) => { setOpen(next); if (!next) setEditingRoutine(null); }} onCreated={async () => { setOpen(false); setEditingRoutine(null); await Promise.all([refresh(), client.invalidateQueries({ queryKey: workspaceKeys.conversations() })]); }} />
      <RoutineRuns routine={historyRoutine} onOpenChange={(next) => !next && setHistoryRoutine(null)} />
    </ManagePage>
  );
}

function RoutineDialog({ open, bots, routine, onOpenChange, onCreated }: { open: boolean; bots: Bot[]; routine: Routine | null; onOpenChange(open: boolean): void; onCreated(): Promise<void> }) {
  const api = useVorkApi();
  const [name, setName] = useState(""); const [prompt, setPrompt] = useState(""); const [botId, setBotId] = useState("");
  const [kind, setKind] = useState<"daily" | "weekly" | "once" | "advanced">("daily"); const [time, setTime] = useState("09:00"); const [dateTime, setDateTime] = useState(""); const [weekday, setWeekday] = useState("1"); const [cron, setCron] = useState("0 9 * * *");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  useEffect(() => { if (!open) return; setName(routine?.name ?? ""); setPrompt(routine?.prompt ?? ""); setBotId(routine?.botId ?? ""); if (routine?.trigger.type === "cron") { setKind("advanced"); setCron(routine.trigger.expression); } }, [open, routine]);
  const mutation = useMutation({ mutationFn: async () => { const input: CreateRoutineInput = { name, botId: botId || bots[0]?.id || "", prompt, timezone: routine?.timezone ?? timezone, trigger: toRoutineTrigger(kind, time, dateTime, weekday, cron) }; return routine ? api.request({ operation: "updateRoutine", input: { routineId: routine.id, routine: { ...input, version: routine.version } } }) : api.request({ operation: "createRoutine", input }); }, onSuccess: onCreated });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md rounded-2xl"><DialogHeader><DialogTitle>{routine ? "编辑定时任务" : "创建定时任务"}</DialogTitle></DialogHeader><div className="space-y-3">
    <Input aria-label="名称" placeholder="例如：每日晨报" value={name} onChange={(e) => setName(e.target.value)} />
    <select aria-label="Bot" className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={botId} onChange={(e) => setBotId(e.target.value)}><option value="">选择 Bot</option>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>
    <Textarea aria-label="任务内容" placeholder="告诉 Bot 要做什么" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
    <select aria-label="频率" className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="daily">每天</option><option value="weekly">每周</option><option value="once">单次</option><option value="advanced">高级 Cron</option></select>
    {kind === "once" ? <Input aria-label="执行时间" type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} /> : kind === "advanced" ? <Input aria-label="Cron" value={cron} onChange={(e) => setCron(e.target.value)} /> : <div className="flex gap-2">{kind === "weekly" && <select aria-label="星期" className="h-9 rounded-lg border bg-background px-3" value={weekday} onChange={(e) => setWeekday(e.target.value)}>{["日","一","二","三","四","五","六"].map((x,i)=><option key={i} value={i}>周{x}</option>)}</select>}<Input aria-label="时间" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>}
    <p className="text-[11px] text-muted-foreground">时区：{timezone}</p>{mutation.isError && <p className="text-[12px] text-destructive">创建失败，请检查时间和 Cron。</p>}
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={mutation.isPending || !name.trim() || !prompt.trim() || !(botId || bots[0])} onClick={() => mutation.mutate()}>{mutation.isPending ? "保存中…" : "保存"}</Button></DialogFooter></DialogContent></Dialog>;
}

export function toRoutineTrigger(kind: "daily" | "weekly" | "once" | "advanced", time: string, dateTime: string, weekday: string, cron: string): CreateRoutineInput["trigger"] { if (kind === "once") return { type: "once", runAt: new Date(dateTime).toISOString() }; if (kind === "advanced") return { type: "cron", expression: cron }; const [hour, minute] = time.split(":"); return { type: "cron", expression: `${minute} ${hour} * * ${kind === "weekly" ? weekday : "*"}` }; }
function describeSchedule(routine: Routine) { return routine.trigger.type === "once" ? new Date(routine.trigger.runAt).toLocaleString("zh-CN") : routine.trigger.expression; }
