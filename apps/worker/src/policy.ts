import type { AgentAction } from "@vork/contracts";

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "needs_approval"; reason: string };

const RELATIVE_SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

/**
 * 阶段 3 首批权限：低风险自动允许；未知动作拒绝；预留 needs_approval。
 * 不在此执行工具——仅做门禁判定。
 */
export function evaluateActionPolicy(action: AgentAction): PolicyDecision {
  switch (action.type) {
    case "message.reply":
    case "task.complete":
    case "task.fail":
    case "file.read":
      if (action.type === "file.read" && !isSafeWorkspacePath(action.path)) {
        return { decision: "deny", reason: "unsafe_path" };
      }
      return { decision: "allow" };
    case "file.write":
      if (!isSafeWorkspacePath(action.path)) {
        return { decision: "deny", reason: "unsafe_path" };
      }
      // 本阶段：Bot 工作区内 write 自动允许；高风险写留给 Task 6 审批
      return { decision: "allow" };
  }
}

function isSafeWorkspacePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (trimmed.includes("\0")) return false;
  return RELATIVE_SAFE_PATH.test(trimmed);
}
