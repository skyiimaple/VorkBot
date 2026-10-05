# Vork 功能版 V1：任务安全与恢复设计

日期：2026-09-29。仓库：`/Users/maple/code/repo/vork-bot`。本切片延续 `docs/superpowers/specs/2026-09-28-vork-functional-v1-design-zh-CN.md` 的第三阶段，不包含 Routines、完整 Skills 发布或生产部署。

## 1. 目标

让运行中的任务可以安全暂停、恢复和取消；让 Worker、API 或 Computer 重启后从持久检查点继续；只对明确可重试的失败自动重试；外部副作用结果无法确认时必须停在 `uncertain`，禁止盲目重放。

完成后用户应能在 Electron 对话页完成以下操作：

- 对排队或运行任务请求暂停，并看到“正在暂停”到“已暂停”的状态变化。
- 恢复已暂停任务，从最后一个成功检查点继续。
- 取消尚未结束的任务。
- 处理等待审批和结果不确定的工具动作。
- 关闭并重启 Electron 或后台服务后，重新看到任务状态并继续处理。

## 2. 非目标

- 不实现任意时间点抢占或冻结进程内存；暂停只在原子动作边界生效。
- 不实现通用 BPMN、分布式事务或完整工作流引擎。
- 不保证任意第三方网站都可自动核实副作用。
- 不自动重试策略拒绝、预算超限、输入校验错误和确定性业务错误。
- 不新增生产监控、备份、公开多用户或远程部署能力。

## 3. 状态模型

任务状态扩展为：

```text
queued -> running | paused | cancelled
running -> waiting_approval | paused | uncertain | completed | failed | cancelled
waiting_approval -> queued | failed | cancelled
paused -> queued | cancelled
uncertain -> queued | completed | failed | cancelled
```

`pauseRequestedAt` 是任务字段，不是独立终态：

- `queued` 收到暂停请求时直接转为 `paused`。
- `running` 收到暂停请求时保持 `running` 并设置 `pauseRequestedAt`，对外显示“正在暂停”。
- Worker 在当前原子模型或工具动作结束、结果写入数据库并保存检查点后，转为 `paused`、清除 `pauseRequestedAt` 并释放槽位。
- 暂停请求不会中止正在写文件、点击网页或执行终端命令的中间阶段。

`uncertain` 表示一个潜在副作用动作已经进入执行阶段，但 Worker 没有持久化到可信的成功或失败结果。它不能自动恢复或自动重试。

## 4. 持久模型

### 4.1 tasks 扩展

`tasks.status` 增加 `paused` 和 `uncertain`。新增：

- `pause_requested_at timestamptz null`
- `retry_count integer not null default 0`
- `next_retry_at timestamptz null`

共享 `TaskSchema` 增加 `pauseRequestedAt: datetime | null`、`retryCount: nonnegative integer` 和 `nextRetryAt: datetime | null`，Electron 不自行推断数据库状态。

### 4.2 task_checkpoints

检查点使用追加版本，不覆盖历史：

```text
id, task_id, user_id, version, state_json, created_at
unique(task_id, version)
```

`state_json` 使用共享 Schema 校验，至少保存：

- `nextTurn`：下一模型轮次。
- `lastObservation`：最近一次已持久化工具观察，最多 4000 字符。
- `reply`：当前待完成回复。
- `modelTurns`、`toolCalls`：累计预算计数。
- `lastCompletedToolCallId`：最近一次确认成功的工具调用。

每次模型动作完成、工具结果确认、审批解决和暂停落地后写入新版本。恢复只读取最高版本。

### 4.3 tool_calls

每个工具动作先持久化，再调用 Computer：

```text
id, task_id, user_id, turn, attempt, action_json, risk,
status, observation, error_code, created_at, updated_at
unique(task_id, turn, attempt)
```

- `risk`: `safe | side_effect`
- `status`: `prepared | executing | succeeded | failed | uncertain`

副作用动作包括 `browser.click`、`browser.type`、`terminal.start`、`terminal.write`、`file.write`、`file.mkdir`、`file.move` 和 `file.delete`。其余观察、读取、导航、滚动和终止动作按 V1 视为安全可重试。

执行顺序固定为：

1. 插入 `prepared`。
2. 更新为 `executing`。
3. 调用 Computer。
4. 成功时在同一数据库事务中保存 observation、标记 `succeeded`、写检查点和 `tool.finished`。
5. 确定性失败标记 `failed` 并记录稳定错误码。
6. 连接中断、Worker 退出或响应丢失导致结果不可判断时，副作用动作标记 `uncertain`，任务转为 `uncertain`。

工具调用 ID 同时作为 Worker 内部幂等键。重试会增加 `attempt`，保留原调用记录；Computer V1 不承诺跨重启去重，因此只有 `prepared` 且尚未进入 `executing` 的副作用动作可以自动开始。

## 5. Worker 行为

### 5.1 检查点恢复

Agent 循环启动时读取最新检查点和未完成 `tool_call`：

- 无未完成调用：从检查点的 `nextTurn`、observation、reply 和预算继续。
- `safe + executing`：标记为可重试，并按原 turn 重新执行。
- `side_effect + executing`：转为 `uncertain` 后停止。
- `succeeded`：绝不重复执行，直接使用已保存 observation。

确定性 FakeActionModel 必须只依据 `ctx.turn` 与检查点输入选择下一动作，不能依赖进程内自增游标。真实 ActionModel 的恢复提示包含最近检查点与已完成动作摘要。

### 5.2 暂停与取消

Worker 在以下安全边界调用统一 `honorTaskControl()`：模型返回后、策略判定前、工具完成并保存后、发送回复分块之间。模型请求期间启动每 500 毫秒一次的轻量任务状态检查；发现取消后触发 AbortController，发现暂停后仅记录请求，仍等模型请求回到安全边界。

- 检测到 `pauseRequestedAt`：保存检查点，转 `paused`，释放 lease 并正常退出 Job。
- 检测到 `cancelled`：停止继续规划，释放 lease；TerminalService 的 lease release 负责终止会话进程组。
- 模型 HTTP 请求接收 AbortSignal；取消时可中止请求。已经提交给 Computer 的副作用动作不强制中断，而是按确定结果或 `uncertain` 收敛。

### 5.3 自动重试

统一重试分类：

- 槽位繁忙：保留已有 5 秒、最多 60 次策略。
- 模型 429、模型 5xx、Computer 连接建立失败且尚未执行工具：最多 3 次，延迟 1 秒、2 秒、4 秒。
- 安全工具的临时连接错误：最多 3 次，延迟 1 秒、2 秒、4 秒。
- 副作用工具进入 `executing` 后的连接错误：不重试，转 `uncertain`。
- 策略拒绝、预算超限、4xx 输入错误和确定性 Computer 错误：直接失败或等待审批。

每次延迟重试写 `task.retry_scheduled`，包含公开错误码、次数和下次时间，不保存 Secret 或完整终端输出。成功重新运行后清除 `nextRetryAt`，累计 `retryCount` 保留用于审计。

### 5.4 启动恢复

Worker 启动后执行一次恢复扫描：

- `queued`：若队列中没有同一恢复 Job，则以稳定 jobId 入队。
- 旧 `running`：检查未完成工具调用；安全状态重新入队，副作用 `executing` 转 `uncertain`。
- `paused`、`waiting_approval`、`uncertain`：保持等待用户，不自动入队。

扫描和入队使用稳定 jobId，可重复执行，不制造重复任务。

## 6. API

新增或补齐：

- `POST /v1/tasks/:id/pause`
- `POST /v1/tasks/:id/resume`
- `POST /v1/tasks/:id/cancel`（沿用现有路由）
- `GET /v1/tasks/:id/control-state`
- `POST /v1/tasks/:id/uncertain-resolution`
- `GET /v1/conversations/:id/active-task`

`uncertain-resolution` 输入为：

- `confirmed_success`：用户已核实动作成功；将工具调用标记成功，生成检查点并重新入队。
- `retry`：用户确认动作未发生或可安全重做；将原调用标记失败，生成新的恢复检查点并重新入队。
- `cancel`：取消任务。

等待审批继续沿用 `/v1/tasks/:id/approvals`，但可恢复动作扩展到全部需要审批的工具类型。所有状态转换在数据库事务中同时写事件。

`control-state` 和 `active-task` 返回共享 `TaskControlStateSchema`：`task`、可选 `pendingApproval`、可选 `uncertainToolCall`。审批摘要仅返回动作类型、风险原因和影响对象；不返回文件正文、完整命令、终端输出或 Secret。`active-task` 没有未结束任务时返回 `{ controlState: null }`。

API 返回：

- `404`：任务不存在或不属于当前用户。
- `409`：状态不允许该操作。
- `500`：状态已持久化但恢复入队失败；任务转为稳定失败码 `TASK_PUBLICATION_FAILED`。

## 7. Electron 交互

对话加载时除消息外，还读取该对话最近一个未结束任务，确保应用重启后可恢复控制面板。

标题栏保持紧凑：

- `queued/running`：显示暂停与取消。
- `running + pauseRequestedAt`：显示“正在暂停”，保留取消。
- `paused`：显示恢复与取消。
- `waiting_approval`：聊天流内显示审批卡片，含动作摘要、风险原因、影响对象、批准和拒绝。
- `uncertain`：显示结果不确定卡片，提供“已完成，继续”“未完成，重试”“取消任务”。

实时电脑画面仍默认隐藏。工具事件、终端输出和检查点详情只在按需展开的执行区域展示，本切片不新增常驻大面板。

## 8. 事件与错误码

新增事件：

- `task.pause_requested`
- `task.paused`
- `task.resumed`
- `task.retry_scheduled`
- `checkpoint.saved`
- `checkpoint.restored`
- `tool.uncertain`
- `tool.uncertain_resolved`

新增稳定错误码：

- `TRANSIENT_RETRY_EXHAUSTED`
- `UNCERTAIN_SIDE_EFFECT`
- `CHECKPOINT_INVALID`
- `TASK_PUBLICATION_FAILED`

事件 payload 只包含公开标识、动作类型、路径摘要和错误码；不记录 Secret、Cookie、完整命令输出或凭据。检查点中的 observation 在写入前截断为 4000 字符，并对凭据格式和 Computer 明确标记的敏感字段做脱敏。

## 9. 测试与验收

测试先行，至少覆盖：

1. 状态 Schema 接受 `paused/uncertain` 并拒绝非法迁移输入。
2. 运行任务请求暂停时，当前工具只执行一次，完成后生成检查点并进入 `paused`。
3. 恢复任务从下一 turn 开始，不重复已成功的文件写入或终端命令。
4. Worker 在副作用 `executing` 状态重启时将任务转 `uncertain`。
5. 用户确认成功后继续；选择重试时仅重新执行明确允许的动作；取消后不再入队。
6. 安全临时错误按 1/2/4 秒有限重试，副作用不确定错误不自动重试。
7. Worker 启动恢复扫描可重复运行且不重复入队。
8. Electron 重新打开对话后恢复任务状态；暂停、恢复、取消、审批和不确定卡片可操作。
9. E2E 完成“运行中暂停 → 已暂停 → 恢复 → 完成”和“模拟不确定副作用 → 用户处理 → 完成”。

## 10. 实施边界

本切片优先改造统一 Agent 循环。旧 `[file-demo]`、`[browser-demo]` 固定剧本继续可用，但只要求取消与现有终态安全，不为其新增完整检查点；可恢复验收使用 `[agent-file]`、`[agent-terminal]` 和 `[agent-llm]`。

数据库迁移必须幂等且兼容已有本地数据。所有新 IPC/HTTP 输入继续使用共享 Zod Schema。Renderer 不直接访问数据库、Computer 地址或 token。
