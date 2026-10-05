# Agents Computer Function Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 OpenAI Agents API 能通过 Vork Worker 安全调用现有文件、终端和浏览器能力。

**Architecture:** 将现有 `AgentToolAction` 作为唯一内部工具协议；新增 Agents Function Tool 定义与参数解析适配层，运行时将 Agents 的 function call 交给任务级执行器。执行器延迟申请 Computer 槽位，复用现有策略、工具事件、重试和释放逻辑，并将文本观察结果返回给同一 Agents turn。

**Tech Stack:** TypeScript、OpenAI Node SDK 7.25、Zod、BullMQ、PostgreSQL、Vitest、Vork Computer HTTP API

**Spec:** `docs/superpowers/specs/2026-09-30-vork-unified-agent-design-zh-CN.md`

## Global Constraints

- Electron 主界面保持简洁，执行画面默认隐藏。
- 文件路径只能位于 Bot 工作区内。
- 危险操作不得绕过 `evaluateActionPolicy`。
- Computer 槽位必须首次调用工具时才申请，并在 turn 结束后释放。
- 不提交 Git commit。

---

### Task 1: Function Tool 契约适配层

**Files:**
- Create: `apps/worker/src/agents-computer-tools.ts`
- Test: `apps/worker/src/agents-computer-tools.test.ts`

**Interfaces:**
- Produces: `AGENTS_COMPUTER_TOOL_DEFINITIONS`、`parseAgentsComputerToolCall(name, arguments)`。
- Consumes: `AgentActionSchema` / `AgentToolAction`。

- [x] 写测试，覆盖三类工具映射、必填参数、未知工具和非法路径动作的契约解析。
- [x] 运行测试并确认因模块缺失而失败。
- [x] 实现最小定义与解析逻辑。
- [x] 运行测试确认通过。

### Task 2: Agents 运行时工具回调

**Files:**
- Modify: `apps/worker/src/openai-agents-runtime.ts`
- Modify: `apps/worker/src/openai-agents-runtime.test.ts`

**Interfaces:**
- Extends: `OpenAIAgentsTurnInput.onToolCall(action)`。
- Produces: 首次与后续会话一致的 Function Tool 调用行为。

- [x] 写失败测试，模拟 `requires_action` 并断言工具结果被提交、turn 继续到最终答案。
- [x] 运行测试验证红灯来自缺少工具处理。
- [x] 为 agent 注册 Function Tools，并处理首次/后续 session 的工具回调。
- [x] 运行测试确认通过。

### Task 3: 任务级 Computer 执行上下文

**Files:**
- Create: `apps/worker/src/agents-computer-executor.ts`
- Test: `apps/worker/src/agents-computer-executor.test.ts`
- Modify: `apps/worker/src/run-openai-agent-task.ts`
- Modify: `apps/worker/src/run-openai-agent-task.test.ts`

**Interfaces:**
- Produces: `createAgentsComputerExecutor(...)`，拥有 `execute(action)` 与 `close()`。
- Consumes: `AgentComputerClientLike`、repositories、notifier、policy、`executeToolAction`。

- [x] 写失败测试，证明纯问答不申请槽位、首个工具调用申请一次、多个工具复用槽位、结束必释放。
- [x] 写失败测试，证明策略拒绝不会执行，需审批动作进入 `waiting_approval`。
- [x] 实现延迟租约、心跳、策略门禁和工具执行复用。
- [x] 将执行器注入 Agents turn，并在 finally 中释放。
- [x] 运行相关测试确认通过。

### Task 4: Worker 组装与恢复边界

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/run-task.ts`
- Modify: `apps/worker/src/run-task.test.ts`

**Interfaces:**
- Consumes: Worker 的 `computer` 与 Agents runtime。
- Produces: 配置 Computer 时 Agents 工具可用；未配置时纯问答仍可用，工具调用返回稳定错误。

- [x] 写失败路由测试。
- [x] 把 Computer 依赖传给 Agents 任务适配器。
- [x] 运行 Worker 相关测试与类型检查。

### Task 5: 全量验证与运行验收

**Files:**
- Modify: `README.zh-CN.md`

- [x] 更新中文说明，记录 Agents 工具能力、审批和回退行为。
- [x] 运行 `pnpm test`。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm --filter @vork/desktop build`。
- [x] 运行 `git diff --check`。
- [x] 启动 Compose，运行 `pnpm healthcheck`，随后按用户偏好关闭服务。
