import type { AgentAction } from "@vork/contracts";

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "needs_approval"; reason: string };

const RELATIVE_SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const FORBIDDEN_TERMINAL = /(?:^|[;&|\s])(?:sudo|docker|podman)(?:$|\s)|(?:^|\s)\/(?:etc|proc|sys|dev|var\/run)(?:\/|\s|$)|docker\.sock/i;
const APPROVAL_TERMINAL = /(?:^|[;&|\s])(?:curl|wget)(?:$|\s)|\b(?:npm|pnpm|yarn|pip|brew|apt|apk)\s+(?:install|add)\b|\bgit\s+clone\b|(?:^|[;&|\s])(?:bash|sh)\s+[^-\s]/i;

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
    case "file.list":
      if (action.path && !isSafeWorkspacePath(action.path)) return { decision: "deny", reason: "unsafe_path" };
      return { decision: "allow" };
    case "file.stat":
    case "file.mkdir":
      if (!isSafeWorkspacePath(action.path)) return { decision: "deny", reason: "unsafe_path" };
      return { decision: "allow" };
    case "file.move":
      if (!isSafeWorkspacePath(action.from) || !isSafeWorkspacePath(action.to)) {
        return { decision: "deny", reason: "unsafe_path" };
      }
      return { decision: "needs_approval", reason: "file_move" };
    case "file.delete":
      if (!isSafeWorkspacePath(action.path)) return { decision: "deny", reason: "unsafe_path" };
      return { decision: "needs_approval", reason: "destructive_file_operation" };
    case "browser.navigate":
    case "browser.observe":
    case "browser.click":
    case "browser.type":
    case "browser.scroll":
    case "terminal.read":
    case "terminal.terminate":
      return { decision: "allow" };
    case "terminal.start":
      return evaluateTerminalText(action.command ?? "");
    case "terminal.write":
      return evaluateTerminalText(action.input);
    case "file.write":
      if (!isSafeWorkspacePath(action.path)) {
        return { decision: "deny", reason: "unsafe_path" };
      }
      if (action.path === "sensitive" || action.path.startsWith("sensitive/")) {
        return { decision: "needs_approval", reason: "sensitive_write" };
      }
      return { decision: "allow" };
    case "memory.propose":
      if (action.sensitivity === "sensitive") {
        return { decision: "needs_approval", reason: "sensitive_memory" };
      }
      return { decision: "allow" };
  }
}

function evaluateTerminalText(command: string): PolicyDecision {
  if (FORBIDDEN_TERMINAL.test(command)) return { decision: "deny", reason: "forbidden_terminal_command" };
  if (APPROVAL_TERMINAL.test(command)) return { decision: "needs_approval", reason: "terminal_network_or_install" };
  return { decision: "allow" };
}

function isSafeWorkspacePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (trimmed.includes("\0")) return false;
  return RELATIVE_SAFE_PATH.test(trimmed);
}
