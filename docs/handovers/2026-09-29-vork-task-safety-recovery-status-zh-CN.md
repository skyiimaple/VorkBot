# Vork 任务安全与恢复交接状态

日期：2026-09-29

## 本次完成

- 任务状态增加 `paused` 与 `uncertain`，并持久化暂停请求、累计重试次数和下次重试时间。
- PostgreSQL 增加追加式检查点与工具调用日志；工具动作记录 `prepared → executing → succeeded/failed/uncertain` 生命周期。
- Electron 对话页支持暂停、恢复、取消、审批，以及不确定结果的三种人工决策；实时电脑画面继续默认隐藏。
- Agent 从最新检查点恢复模型轮次、观察结果、回复和预算计数。已确认成功的副作用不重复执行。
- 模型 429/5xx 与安全工具的临时错误采用 1/2/4 秒退避，最多重试 3 次。
- Worker 启动时扫描可恢复任务；正在执行且结果未知的副作用转入 `uncertain`，不会自动重放。
- API 恢复发布使用稳定 job ID，并在发布失败时以稳定错误码收敛任务。
- 新增 `[agent-pause]`、`[agent-uncertain]` 两条真实 Electron 本地验收路径。

## 用户可见行为

暂停是“请求在下一安全边界暂停”，不是杀死当前进程。任务显示“正在暂停”时，当前原子动作仍会完成并记录结果；随后任务进入“已暂停”。恢复后从最新检查点继续。

结果不确定表示副作用可能已经完成，但 Worker 没有拿到可信响应：

- “已完成，继续”：把该动作视为成功，从下一步继续。
- “未完成，重试”：明确授权再次执行，并分配新的 attempt，保留旧记录。
- “取消任务”：保留现有记录并终止任务。

## 数据与安全边界

- PostgreSQL 是任务控制状态、检查点和工具调用状态的唯一可信来源。
- 检查点 observation 上限为 4000 字符，并遮盖 Bearer、常见 API Key 和 Cookie 值。
- Electron Renderer 不持有数据库、Computer URL 或 Computer token；所有控制都经过结构化 IPC 和 API。
- 本次未包含生产部署、多用户鉴权、Routines/定时任务和 Skills 自动总结。

## 验证

最终交付前执行：

```sh
VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
pnpm --filter @vork/e2e exec playwright test --workers=1
pnpm healthcheck
```

定向真实流程已通过：

- 暂停 → 安全边界落地 → 恢复 → 完成。
- 副作用响应丢失 → `uncertain` → 用户明确重试 → 使用新 attempt 完成。
- 浏览器演示打开测试页、观察控件、点击和输入。

最终验证结果：

- `pnpm test`：退出码 0；Contracts 36、Computer 39（另 2 个环境相关跳过）、Desktop 53、Database 17、API 40、Worker 76，其余既有套件同时通过。
- `pnpm typecheck`：全工作区退出码 0。
- `pnpm --filter @vork/desktop build`：退出码 0；只有依赖中的 `use client` 打包提示。
- `pnpm --filter @vork/e2e exec playwright test --workers=1`：4/4 通过。
- 数据库迁移重复执行成功；Worker 连续重启两次后全部服务健康。
- 数据抽查：重复 `(task_id, turn, attempt)` 为 0；事件和检查点中的常见凭据模式命中为 0。

## 工作区说明

- 按用户要求直接在 `main` 工作区修改。
- 按用户要求未执行 `git commit`、`git push` 或创建 PR。
- 所有源码、测试、迁移和文档修改保持为未提交状态，交接时以 `git status --short` 为准。
