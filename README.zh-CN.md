# Vork 本地开发版

这是单用户的本地开发版：可通过 Electron 创建 Bot、聊天；默认用确定性 FakeModel 流式回复，配置 `LLM_API_KEY` 后 Worker 走 OpenAI-compatible 真实模型（如 DeepSeek）。阶段 2 已接入云电脑（Compose 内独立 `computer` 服务）：文件工具、浏览器工具、JPEG 画面面板、人工接管状态机，以及三槽并发与浏览器限额。终端尚未接入。不要将此 Compose 配置直接暴露到公网。

## 环境与启动

需要 macOS、Node.js 22+、pnpm 10+ 和 Docker。首次运行先执行 `pnpm install`。复制 `.env.example` 为 `.env`，其中密码仅适用于本地开发；如更改 `VORK_DB_PASSWORD`，同步更改 `DATABASE_URL`。不要将 `.env` 提交到仓库。

```sh
docker compose up -d --build
pnpm healthcheck
pnpm smoke              # 可选：health → 建 Bot → 发「你好」→ 等助手回复
pnpm smoke -- --file-demo   # 可选：再验 [file-demo]
pnpm dev
```

更完整的服务端口、冒烟步骤、退出码与真/假边界见 [`docs/handovers/2026-09-20-vork-local-stack-zh-CN.md`](docs/handovers/2026-09-20-vork-local-stack-zh-CN.md)。

Compose 依次启动 PostgreSQL、Valkey、数据库迁移、Computer、API 和 Worker；API 只监听本机 `127.0.0.1:3000`，Computer 仅在 Compose 内网可达（`http://computer:8080`）。Electron 使用本机 API，客户端关闭后 Worker 仍在容器里运行。数据库、工作区与浏览器 Profile 存放在 Docker 命名卷中。Computer 默认 `VORK_MAX_SLOTS=3`、浏览器并发上限 2，并配置 `mem_limit: 4g` / `cpus: 2`。

### 云电脑演示（阶段 2）

- `[file-demo]`：申请槽位 → 写入/读取 `notes/hello.txt` → 返回摘要。
- `[browser-demo]`：打开自建测试页 → observe → click → type → 返回摘要。
- 对话标题栏「电脑」：展开后每 500ms 经 API 拉取 JPEG 画面；折叠后停止轮询。
- 槽位繁忙时任务保持排队，Worker 以 5s 退避延迟重试（最多约 5 分钟）。

Computer 不映射宿主机端口，仅由 Worker/API 通过内网调用；桌面不持有 Computer 地址或 token。

### 真实模型（阶段 3 最小切片）

在 `.env`（已 gitignore）填写：

```sh
LLM_API_KEY=sk-...          # 空则回退 FakeModel
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

`LLM_BASE_URL` 可不带 `/v1`（Worker 会自动补全）。改完后重建/重启 Worker：`docker compose up -d --build worker`。桌面发消息即可；或 `pnpm smoke`（已不校验 FakeModel 固定文案）。`[file-demo]` / `[browser-demo]` 仍走 Computer 固定剧本；`[agent-file]` 走阶段 3 受控 Agent 循环（FakeActionModel 动作序列 + 预算护栏），不经 LLM。

## 测试与排查

```sh
export TEST_DATABASE_URL=postgres://vork:vork_test_only@127.0.0.1:55432/vork_test
pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
pnpm e2e
docker compose logs api worker computer migrate
```

`pnpm e2e` 需要 Compose 服务已就绪，并使用构建后的 Electron 入口。基础用例覆盖创建 Bot 与流式回复；`browser-demo` E2E 为推荐加严项（失败不挡阶段 2）。`pnpm healthcheck` 检查 API、数据库、Valkey、Worker 心跳与 Computer 健康状态。`pnpm smoke`（`scripts/dev-smoke.mjs`）用 HTTP 走一遍 health → 创建 Bot → 发消息 → 轮询至非空 assistant 回复（兼容 FakeModel / 真模型）；加 `--file-demo` / `--sse` / `--timeout=<ms>` 可加严。测试数据库使用单独的 `TEST_DATABASE_URL`，不要指向包含个人数据的数据库。本地跑浏览器集成测试需先安装 Playwright Chromium：`pnpm --filter @vork/computer exec playwright install chromium`。

## 停止与数据

`docker compose down` 会停止容器，但保留 PostgreSQL、工作区与浏览器 Profile 命名卷。若确实要清空本地开发数据，请先自行确认卷名与内容；本项目的常规停止流程不会删除卷（不要使用 `docker compose down -v`，除非你明确要清空）。
