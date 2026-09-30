# Vork 本地开发版

这是单用户的本地开发版：可通过 Electron 创建 Bot、聊天；默认使用确定性 FakeModel，配置 `LLM_API_KEY` 后可接入 OpenAI-compatible 模型。云电脑由 Compose 内独立 `computer` 服务提供文件、浏览器和终端工具、JPEG 画面面板及人工接管状态机。不要将此 Compose 配置直接暴露到公网。

## 环境与启动

需要 macOS、Node.js 22+、pnpm 10+ 和 Docker。首次运行先执行 `pnpm install`，并按需复制 `.env.example` 为 `.env`。

```sh
docker compose up -d --build
pnpm healthcheck
pnpm smoke
pnpm dev
```

镜像已与源码一致时可用 `docker compose up -d --no-build`。Electron 关闭后 Worker 仍在容器运行；数据库、工作区和浏览器 Profile 保存在 Docker 命名卷中。

### 云电脑与 Agent

- `[file-demo]`：写入并读取演示文件。
- `[browser-demo]`：在自建测试页执行 observe/click/type。
- 对话标题栏“电脑”：按需展开 JPEG 画面；默认折叠，折叠后停止轮询。
- `[agent-file]` / `[agent-llm]`：执行受策略、预算、审批和恢复机制约束的 Agent 循环。
- 敏感写入和敏感记忆进入 `waiting_approval`，不会绕过用户批准。

远程模型可在 `.env` 或桌面“模型凭据”中配置：

```sh
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

### 定时任务（Routines）

从左下角“本地用户”菜单进入“定时任务”。创建时选择 Bot、填写任务内容，并选择单次、每天、每周或标准五段 Cron；默认使用当前 IANA 时区（通常为 `Asia/Shanghai`）。

- 每个 Routine 永久绑定一个专属对话，所有运行结果追加到同一对话。
- 支持创建、编辑、暂停、恢复、立即运行和软删除；删除保留专属对话与历史。
- Worker 每 5 秒扫描 PostgreSQL 中的到期计划；重启后错过多个周期最多补一次，`missedCount` 记录额外错过次数。
- 同一个 Routine 严格单实例；上一次仍在运行时，新周期记录 `skipped_overlap`，不会并发或排队。
- PostgreSQL 是长期计划的唯一可信来源，Redis/BullMQ 只承载已创建的 TaskJob。

## 测试与排查

```sh
export VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test
pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
pnpm e2e
pnpm healthcheck
docker compose logs api worker computer migrate
```

E2E 需要 Compose 服务已就绪，并使用构建后的 Electron 入口。测试数据库必须是独立的 `*_test` 数据库，不要指向个人开发数据。

## 停止与数据

`docker compose down` 会停止容器但保留 PostgreSQL、工作区和浏览器 Profile。不要使用 `docker compose down -v`，除非你明确要清空这些数据。

当前版本面向单用户开发环境，尚未包含生产部署、多用户权限、通知渠道或多 Agent 协作调度。
