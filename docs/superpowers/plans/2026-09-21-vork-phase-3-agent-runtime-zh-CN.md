# Vork 阶段 3：真实 Agent、记忆与 Skills 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在已交付的云电脑工具面上，接入可配置模型供应商与受控 Agent 循环，落地任务预算、权限/审批、身份/事实/工作记忆，以及「保存为 Skill」草稿；多 Bot 委派与 routines 仅保留契约，不向模型/客户端开放。

**架构：** Worker 内 `agent-loop` 每轮只接受经 Zod 校验的**单一**类型化动作；权限层决定允许/拒绝/等待审批；工具经现有 Computer 客户端执行；PostgreSQL 保存记忆/审批/Skill 草稿与预算计数；模型凭据以环境变量起步，再补管理 API 持久化（密钥只写不读）。桌面以少改为原则，除非阶段硬性需要（取消/创建助手意图已接）。

**技术栈：** TypeScript、Node.js 22+、pnpm、Fastify、Zod、Vitest、BullMQ、现有 Computer HTTP 工具面、OpenAI-compatible Chat Completions。

**规格：** `docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md`（§7 Agent Runtime、§11 记忆、§12 Skills、§13 权限）；路线图 `docs/superpowers/plans/2026-09-14-vork-implementation-roadmap-zh-CN.md`。

## 全局约束

- 模型不得直接控制 Docker/宿主机；只能产出 Schema 校验通过的动作。
- 每轮模型调用只返回**一个**动作；循环间检查取消信号与租约心跳。
- 每个任务限制：模型轮数、工具调用次数、运行时长；Token/费用预算本阶段可先用轮数/时长近似，费用计量可后置。
- 自动化以 FakeActionModel / 固定动作序列为主；真模型冒烟另开、不挡主验收。
- 密钥不入仓库、不写 `task_events`、不回读到管理列表。
- 尽量少改 `apps/desktop/src/renderer`；新能力优先 API/Worker/contracts。
- 多 Bot 委派与 routines：只定义存储边界，不向模型开放。
- 每项任务测试先行；通过后可独立提交（简体中文 Conventional Commits）。

## 已完成切片（进入本计划前）

| 项 | 状态 | 说明 |
|----|------|------|
| T0a OpenAI-compatible 真模型 | ✅ | `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`；无 key → FakeModel |
| T0b 任务取消 | ✅ | `POST /v1/tasks/:id/cancel` + Worker abort + NL `isCancelUtterance` |
| T0c 创建助手意图 | ✅ | `parseCreateAssistantIntent` + persona→systemPrompt + skill 文档 |
| T0d 管理页 stub | ✅ | tasks/skills/files/credentials 列表 stub（非持久凭据） |

## 文件结构（本阶段新增/重点）

```text
packages/contracts/src/agent.ts     AgentAction、TaskBudget、事件 payload
apps/worker/src/budget.ts           预算计数与超限判定
apps/worker/src/policy.ts           允许 / 拒绝 / 需审批
apps/worker/src/agent-loop.ts       受控循环编排
apps/worker/src/fake-action-model.ts 固定动作序列（自动化）
apps/worker/src/action-model.ts     真模型 → AgentAction 适配（后续 Task）
packages/database/…                memories / approvals / skills 表（后续 Task）
skills/…                            仓库内 Skill 手册（与 DB 草稿并存）
```

---

## Task 1：Agent 动作与预算契约

**文件：**
- 创建：`packages/contracts/src/agent.ts`
- 修改：`packages/contracts/src/index.ts`
- 测试：`packages/contracts/src/agent.test.ts`

**接口：**
- 产出：`AgentActionSchema`（`message.reply` | `task.complete` | `task.fail` | `file.write` | `file.read`；本 Task 不含 browser/memory/approval）
- 产出：`TaskBudgetSchema`（`maxModelTurns`、`maxToolCalls`、`maxDurationMs`）
- 产出：`DEFAULT_TASK_BUDGET` 常量；事件 type 常量 `agent.action`、`budget.exceeded`

- [x] **Step 1：写失败测试**（断言合法 `file.write` 通过、未知 type 失败、预算正整数）
- [x] **Step 2：实现 Schema 与默认预算**
- [x] **Step 3：测试通过** — `pnpm --filter @vork/contracts test`
- [x] **Step 4：Commit** — 已并入 `a535a48`（Task 1–3 同批）

---

## Task 2：预算护栏模块

**文件：**
- 创建：`apps/worker/src/budget.ts`
- 测试：`apps/worker/src/budget.test.ts`

**接口：**
- 产出：`createBudgetTracker(budget)` → `{ recordModelTurn(), recordToolCall(), assertWithinBudget(startedAt), snapshot() }`
- 超限抛出带 code `BUDGET_EXCEEDED` 的错误

- [x] **Step 1–4：** TDD 实现；已提交 `a535a48`

---

## Task 3：受控 Agent 循环（Fake 动作序列 + 文件工具）

**文件：**
- 创建：`apps/worker/src/fake-action-model.ts`
- 创建：`apps/worker/src/agent-loop.ts`
- 修改：`apps/worker/src/run-task.ts`（识别 `[agent-file]` 走循环，保留 `[file-demo]` 旧剧本）
- 测试：`apps/worker/src/agent-loop.test.ts`

**接口：**
- `ActionModel.nextAction(ctx) → Promise<AgentAction>`
- `runAgentLoop(job, deps)`：claim running → 循环 nextAction → 执行 → 检查取消/预算 → complete/fail
- Fake 序列：`file.write` → `file.read` → `message.reply` → `task.complete`

- [x] **Step 1–4：** 集成测试通过；已提交 `a535a48`

---

## Task 4：真模型结构化动作（OpenAI-compatible）

**文件：** `apps/worker/src/action-model.ts`、测试 `action-model.test.ts`；`run-task` 识别 `[agent-llm]`

- [x] JSON / `response_format: json_object` 约束输出为 `AgentAction`；解析失败 → `task.fail(INVALID_AGENT_ACTION)`
- [x] 聊天路径继续 `streamReply`；`[agent-llm]` 走 ActionModel（有 key 用 OpenAICompatibleActionModel）
- [x] 常规单测 mock fetch，不打真网

---

## Task 5：权限策略层（低风险自动允许）

**文件：** `apps/worker/src/policy.ts`；接入 `agent-loop`

- [x] `file.read` / `message.reply` / `task.complete` / 工作区内 `file.write` → allow
- [x] 不安全路径 → deny（`POLICY_DENIED`）
- [x] 预留 `needs_approval` 返回值供 Task 6

---

## Task 6：审批状态机

- [x] 任务状态增加 `waiting_approval`；事件 `approval.request` / `approval.resolved`
- [x] `POST /v1/tasks/:id/approvals`：拒绝 → `APPROVAL_REJECTED`；批准目前仅落地 `memory.propose`
- [x] 敏感路径 `sensitive/` 与 `sensitivity=sensitive` 的记忆进入等待，不直接执行
- [x] 本阶段不做 macOS 通知

---

## Task 7：记忆（身份 / 事实 / 工作）

- [x] 表 `memories`；动作 `memory.propose`（普通自动写入并去重，敏感需审批）
- [x] 任务完成时压缩工作记忆；`GET /v1/bots/:id/memories`

---

## Task 8：Skills 草稿

- [x] `POST /v1/skills` 把已完成任务存为 draft；`GET /v1/skills` 列出草稿
- [x] 同一 Bot 第二次成功任务追加 `skill.suggest`（不自动启用）

---

## Task 9：凭据持久化（密钥只写不读）

- [x] `PUT /v1/credentials` 写入；`GET` 只返回掩码，不含明文
- [x] Worker 启动：已有 `LLM_API_KEY` 优先，否则读库中 `user_local` 凭据
- [ ] 桌面管理页表单后置（仍为说明页）

---

## Task 10：文档与验收收尾

- [x] 更新 `README.zh-CN.md` 与 handover 的 Fake/真模型及审批、记忆、Skill、凭据路径

## 本阶段不做

- 终端 PTY、多 Bot 委派执行、routines 定时 UI、公网部署/签名（阶段 4）、视觉模型主路径

## 验收标准（阶段 3 完成时）

1. FakeActionModel 经 Agent 循环完成文件读写并回复，事件含 `agent.action` / tool 生命周期。
2. 超预算任务失败，事件 `budget.exceeded`。
3. 取消在循环步间立即生效。
4. 有 `LLM_API_KEY` 时可聊天；结构化动作冒烟可选通过。
5. 记忆可写入并在后续任务检索到；Skill 草稿可审核、默认不启用。
6. 凭据可配置且密钥不出现在 GET 响应与日志。
