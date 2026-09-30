import type { Routine } from "@vork/contracts";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useVorkApi } from "@/features/chat/useConversation";

export function RoutineRuns({ routine, onOpenChange }: { routine: Routine | null; onOpenChange(open: boolean): void }) {
  const api = useVorkApi();
  const query = useQuery({
    queryKey: ["routine-runs", routine?.id],
    enabled: Boolean(routine),
    queryFn: async () => {
      const response = await api.request({ operation: "listRoutineRuns", input: { routineId: routine!.id, limit: 20 } });
      if (response.operation !== "listRoutineRuns") throw new Error("Unexpected response");
      return response.data.runs;
    }
  });
  return <Dialog open={Boolean(routine)} onOpenChange={onOpenChange}><DialogContent className="max-w-lg rounded-2xl"><DialogHeader><DialogTitle>{routine?.name} · 运行历史</DialogTitle></DialogHeader>
    <div className="max-h-[420px] space-y-2 overflow-y-auto">{query.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : !query.data?.length ? <p className="text-sm text-muted-foreground">暂无运行记录。</p> : query.data.map((run) => <div key={run.id} className="rounded-xl border px-3 py-2"><div className="flex justify-between gap-2 text-[12px]"><span>{statusLabel(run.status)}</span><time className="text-muted-foreground">{new Date(run.scheduledFor).toLocaleString("zh-CN")}</time></div>{run.missedCount > 0 && <p className="mt-1 text-[11px] text-muted-foreground">补偿执行，额外错过 {run.missedCount} 次</p>}{run.errorCode && <p className="mt-1 text-[11px] text-destructive">{run.errorCode}</p>}</div>)}</div>
  </DialogContent></Dialog>;
}

function statusLabel(status: string) { return ({ queued: "排队中", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消", paused: "已暂停", waiting_approval: "等待批准", uncertain: "结果待确认", skipped_overlap: "已跳过（上次仍在运行）", publication_failed: "入队失败", claimed: "已抢占" } as Record<string,string>)[status] ?? status; }
