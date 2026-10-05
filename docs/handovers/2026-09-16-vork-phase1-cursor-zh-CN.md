# Vork 第一阶段交接（给 Cursor）

> **已过时（阶段 1 快照）。** 本地起栈、端口、健康检查与冒烟请改读 [`2026-09-20-vork-local-stack-zh-CN.md`](./2026-09-20-vork-local-stack-zh-CN.md)。阶段 2 云电脑已合入 `main`。

交接日期：2026-09-16。仓库：`/Users/maple/code/repo/vork-bot`，当前在 `main`。用户明确允许在 `main` 工作，但要求节省 token：完成一个阶段后再征得同意复核，不要逐任务反复审查。

## 当前进度

第一阶段计划的 Task 1–7 已提交；Task 8（本地 Docker Compose、Worker 心跳、Electron 端到端验收）已经实现，但**仍是未提交的工作区改动**。因此可以说第一阶段的主要功能已做出来，不能说最终工作区已全面验收。最近的提交：

- `58692ed`：安全 Electron Shell。
- `2e988a8`：Bot 创建与对话界面。
- `a4d4f18`：恢复已有对话及任务流重试。
- `65a6d08`：窗口关闭后停止任务流重试（目前最后一个提交）。

现有能力：创建 Bot、创建/恢复对话、发送消息、BullMQ Worker 调用确定性 FakeModel、通过可恢复 SSE 展示消息、Electron 本地界面；本地 Compose 提供 PostgreSQL、Valkey、迁移、API、Worker。界面采用顶部 Bots 的创建入口，实时执行画面默认隐藏。第一阶段**不包含**真实模型接入、真正的云端电脑、浏览器/终端/文件远程操作、Skills 自动总结经验或多 Agent 协作执行；这些属于后续阶段，不能把目前的 FakeModel 聊天误当成完整 Grok Bot 替代品。

设计与任务依据：`docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md`、`docs/superpowers/plans/2026-09-14-vork-phase-1-foundation-zh-CN.md`。本地过程记录在 `.superpowers/sdd/2026-09-14-vork-phase-1-foundation-zh-CN/progress.md`（可能被 Git 忽略）。中文启动说明为尚未提交的 `README.zh-CN.md`。

## Task 8 工作区改动

修改：`.env.example`、`apps/desktop/electron.vite.config.ts`、`apps/desktop/src/main/index.ts`、`apps/desktop/src/main/window.ts` 及其测试、`apps/worker/src/index.ts`、根目录 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。

新增：`.dockerignore`、`compose.yaml`、`infra/docker/{api,worker}.Dockerfile`、`apps/worker/src/heartbeat.ts` 及测试、`scripts/dev-healthcheck.mjs`、`tests/e2e/`、`README.zh-CN.md`。另有未跟踪 `.npmrc`，内容为 `electron_mirror=https://npmmirror.com/mirrors/electron/`，来自此前依赖安装尝试；请保留并让用户决定是否纳入提交，不要顺手删除或提交。`tests/e2e/` 内可能有 Playwright 结果/截图，提交前核对和忽略生成物。

Compose 使用本机已有 `pgvector/pgvector:pg17` 和 `valkey/valkey:8.1` 镜像。数据库卷 `vorkbot_postgres_data` 保存数据；不要执行 `docker compose down -v`。服务端口仅用于本地开发，凭据是开发用默认值 `vork_dev_only`，不能直接部署公网。

Electron 构建有两处关键处理：Main 将 `@vork/contracts` 打包，避免运行时加载 TypeScript 源文件；Preload 输出 CommonJS `out/preload/index.cjs`，以适配 Electron sandbox preload。修改配置时保持对应窗口路径与测试一致。

## 验证记录与边界

- Task 7 最后提交时，desktop 测试 12/12、typecheck、build 通过。
- Task 8 的 `pnpm typecheck` 曾通过；`@vork/e2e` 的 typecheck 也通过。desktop build 已成功输出 `index.cjs`。
- `docker compose up -d --build` 已启动服务；获得 Docker 访问许可后，`node scripts/dev-healthcheck.mjs` 报告 API、PostgreSQL、Valkey、Worker 均 ready。容器可能仍在运行，以当前 `docker compose ps` 为准。
- `pnpm e2e` 曾通过 1/1：创建 Bot、发送“你好”、收到“你好，我是 Vork。”、重启 Electron 后仍可看到回复。
- **最后一次 E2E 通过后**，做了等价的 preload 配置类型修正、测试变量重命名和失败截图附件改动；最新工作区的 E2E **没有重新运行**，因为本次运行所需权限申请未获批准。不要把旧结果称为最终工作区验收。
- 根目录完整 `pnpm test` **没有运行**：API/数据库集成测试需要 `127.0.0.1:55432` 的独立测试 PostgreSQL，而沙箱拒绝访问；提权申请未获批准。根目录测试脚本不包含 E2E，E2E 使用单独 `pnpm e2e`。

## Cursor 的最短后续步骤

1. 先读上述设计、计划和本交接文档，执行 `git status --short`，保留所有现有改动与未跟踪文件。
2. 不申请额外权限即可先运行 `pnpm typecheck`、`pnpm --filter @vork/desktop test`、`pnpm --filter @vork/worker exec vitest run src/heartbeat.test.ts`、`pnpm --filter @vork/desktop build`、`git diff --check`。任何失败先定位原因，不要盲目改版本。
3. 如用户允许 Electron GUI 与本地服务访问，再运行 `docker compose ps`、`node scripts/dev-healthcheck.mjs`、`pnpm e2e`，核对截图及对话重启持久化。Compose 数据不要清卷。
4. 验证后整理生成物和 `.npmrc` 的归属，再提交 Task 8。完整集成测试需用户允许使用隔离的测试数据库；未获许可时明确留作待验项。
5. Task 8 结束后按用户要求**先征求阶段复核许可**，再进入下一阶段。下一阶段应先明确真实模型、云端电脑（浏览器、终端、文件）和隔离/安全边界，不要直接把本地 Compose 当生产方案。

交接原则：报告事实与未验证项；不要因为旧版 E2E 通过就声明现在所有测试通过，也不要为了复核而重复消耗用户 token。
