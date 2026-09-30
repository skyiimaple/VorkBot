import type { TaskControlState, UncertainResolutionInput } from "@vork/contracts";
import { Button } from "@/components/ui/button";

export function TaskControlCard({
  controlState,
  pending,
  onApproval,
  onUncertain
}: {
  controlState: TaskControlState;
  pending: boolean;
  onApproval(decision: "approve" | "reject"): void;
  onUncertain(resolution: UncertainResolutionInput["resolution"]): void;
}) {
  if (controlState.task.status === "waiting_approval" && controlState.pendingApproval) {
    const item = controlState.pendingApproval;
    return (
      <section className="rounded-xl border border-border bg-card p-3 text-sm" aria-label="任务审批">
        <p className="font-medium">需要你的批准</p>
        <p className="mt-1 text-muted-foreground">{item.actionType} · {item.target}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.riskReason}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => onApproval("approve")}>批准</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onApproval("reject")}>拒绝</Button>
        </div>
      </section>
    );
  }
  if (controlState.task.status === "uncertain" && controlState.uncertainToolCall) {
    const item = controlState.uncertainToolCall;
    return (
      <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm" aria-label="结果不确定">
        <p className="font-medium">操作结果需要确认</p>
        <p className="mt-1 text-muted-foreground">{item.actionType} · {item.target}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.riskReason}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => onUncertain("confirmed_success")}>已完成，继续</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onUncertain("retry")}>未完成，重试</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => onUncertain("cancel")}>取消任务</Button>
        </div>
      </section>
    );
  }
  return null;
}
