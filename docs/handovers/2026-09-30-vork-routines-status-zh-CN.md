# Vork 定时任务交接状态（2026-09-30）

## 已完成

- 单次、标准五段 Cron、IANA 时区与 DST 计算。
- Routine 与 RoutineRun PostgreSQL 持久化、原子抢占、启动补偿和重叠跳过。
- 固定专属对话、乐观版本更新、暂停/恢复、软删除、立即运行及游标历史。
- BullMQ 稳定 jobId、发布失败收敛、Task 全生命周期状态同步。
- Worker 启动扫描、5 秒周期扫描、禁止重入和优雅停止。
- 九个 HTTP API、Electron IPC 白名单和 `/routines` 管理页。
- 创建/编辑、单次/每日/每周/高级 Cron、历史、打开对话；电脑画面默认隐藏。

## 明确未包含

- 通知渠道、生产部署和多用户权限。
- 多 Agent 协作调度；仅保留既有协议方向。
- Skills 自动总结经验。

## 数据与迁移

- 新迁移：`packages/database/migrations/0004_routines.sql`。
- PostgreSQL 是计划定义与抢占状态的唯一可信来源；Redis 仅承载已创建的 TaskJob。
- 所有改动保持未提交，不执行 commit、push 或 PR。

## 验证

- Workspace 测试：contracts 40、computer 39 通过/2 跳过、desktop 57、database 31、API 46、Worker 80，全部退出 0。
- Workspace typecheck、Electron build、Playwright 全量 E2E 6/6 通过；其中 Routine 定向 E2E 2/2 通过。
- 真实自动到期扫描、固定对话、立即运行和电脑画面默认隐藏已验收。
- healthcheck、`git diff --check` 和数据库幂等/单实例/暂停/软删除审计通过。
- 如需重跑：参见 `docs/superpowers/plans/2026-09-30-vork-routines.md` Task 8。

## 已知限制

- Cron 精度为分钟，不支持秒、昵称以及 `H/L/#/?` 扩展。
- 当前开发栈使用单一 Worker；数据库行锁允许以后扩展多 Worker。
- 运行历史第一版每页最多 100 条。
- 稳定 BullMQ jobId 使用 `routine-run-{runId}`；冒号格式不兼容 BullMQ，已在真实 E2E 中修正。
