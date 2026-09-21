# Vork 本地栈交接（健康检查 / 冒烟）

交接日期：2026-09-20。仓库：`/Users/maple/code/repo/VorkBot`。  
旧交接 `docs/handovers/2026-09-16-vork-phase1-cursor-zh-CN.md` 仅覆盖阶段 1，且当时 Compose/E2E 仍属未提交状态；**以本文 + `README.zh-CN.md` 为准**。阶段 2（云电脑）相关提交已在 `main`（至 `d77845f`）。

## 服务清单与端口

| 服务 | 宿主机可达 | 说明 |
|------|------------|------|
| PostgreSQL (`postgres`) | `127.0.0.1:5432` | 卷 `postgres_data`；用户/库 `vork` |
| Valkey (`redis`) | `127.0.0.1:6379` | 队列与 Worker 心跳键 `vork:worker:heartbeat` |
| migrate | 无端口 | 一次性迁移，完成后退出 |
| Computer (`computer`) | **无宿主机端口** | Compose 内网 `http://computer:8080`；`/health` |
| API (`api`) | `127.0.0.1:3000` | Electron / 冒烟脚本打这里 |
| Worker (`worker`) | 无端口 | BullMQ 消费；有 `LLM_API_KEY` 时 OpenAI-compatible 真模型，否则 FakeModel；工具编排 |
| Desktop | 本机进程 | `pnpm dev` → Electron |

开发默认凭据见 `.env.example`（`vork_dev_only` / `vork_computer_dev_only`）。**勿对公网暴露 Compose。** 停止用 `docker compose down`；**不要** `down -v`（会清库与工作区卷）。

## 启动（最短路径）

```sh
pnpm install
cp -n .env.example .env   # 已有 .env 则跳过
docker compose up -d --build
pnpm healthcheck          # → scripts/dev-healthcheck.mjs
pnpm smoke                # → scripts/dev-smoke.mjs（health→建 Bot→发「你好」→等助手回复）
pnpm smoke -- --file-demo # 可选：再跑 [file-demo]（需 Computer）
pnpm smoke -- --sse --timeout=60000  # 可选：SSE + 加长超时（真模型更慢时可调）
pnpm dev                  # Electron 桌面
```

健康检查覆盖：PostgreSQL、Valkey、Worker 心跳（15s 内）、Computer `/health`、本机 `GET /v1/bots`。  
冒烟覆盖：先 `GET /v1/bots` → `POST /v1/bots` → `POST .../messages`（「你好」）→ 轮询至出现**非空 assistant 回复**（不绑 FakeModel 固定文案，真模型亦可通过）。可选：`pnpm smoke -- --file-demo` / `--sse` / `--timeout=<ms>`。等待期间若任务变为 `failed`/`cancelled` 会立即失败（不必等到超时）。退出码：`0` 成功，`1` 业务失败，`2` 前置未就绪，`3` 超时，`64` 用法错误。

## 手工冒烟（桌面或 curl）

1. Compose + `pnpm healthcheck` 通过。
2. 桌面：新建聊天 / 创建 Bot → 发「你好」→ 应流式得到助手回复（FakeModel 时为 `你好，我是 Vork。`；真模型则任意非空回复即可）
3. 云电脑（真 Computer，假模型剧本）：发 `[file-demo]`（写读 `notes/hello.txt`）或 `[browser-demo]`（自建测试页）；标题栏「电脑」可展开看 JPEG（折叠停轮询）。
4. 可选加严：`pnpm e2e`（需已 build 的 Electron；`browser-demo` 失败不挡阶段 2）。
5. 单元/集成：`TEST_DATABASE_URL=postgres://vork:vork_test_only@127.0.0.1:55432/vork_test pnpm test`（独立测试库，勿指向个人数据）。

curl 等价示例（API 已就绪时）：

```sh
BOT=$(curl -sS -X POST http://127.0.0.1:3000/v1/bots \
  -H 'content-type: application/json' \
  -d '{"name":"demo","persona":"smoke"}')
CID=$(printf '%s' "$BOT" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).conversation.id))")
curl -sS -X POST "http://127.0.0.1:3000/v1/conversations/$CID/messages" \
  -H 'content-type: application/json' -d '{"content":"你好"}'
# 数秒后：
curl -sS "http://127.0.0.1:3000/v1/conversations/$CID/messages"
```

## FakeModel vs 真 Computer（真/假边界）

| 能力 | 现状 |
|------|------|
| 普通聊天回复 | **可真可假**：未设 `LLM_API_KEY` 时 FakeModel（`你好，我是 Vork。`）；设 key 后走 `LLM_BASE_URL` + `LLM_MODEL`（OpenAI-compatible，如 DeepSeek）流式 `message.delta`。冒烟只断言非空助手回复 |
| 文件 / 浏览器工具 | **真 Computer**：Compose 内 Playwright + 工作区卷；由消息标记 `[file-demo]` / `[browser-demo]` 触发固定剧本，**不是**模型自主规划 |
| 画面面板 | **真**：经 API 代理 Computer JPEG；桌面不持有 Computer URL/token |
| 终端工具 | **未做** |
| 真实 AI 供应商 | **已接最小切片**：环境变量 `LLM_*`；管理页持久化凭据 / Agent 循环 / 预算审批仍未做 |
| Skills / 多 Agent | **未做** |

不要把未配 key 时的 FakeModel 聊天当成「已接 Grok」；也不要把 `[file-demo]` 当成开放式 Agent。

## 工作区注意（2026-09-20）

- **`apps/desktop` 大量未提交改动**（shadcn/UI、路由 `router.tsx`、`AppShell`、Manage 页等）。并行线在改桌面；E2E 选择器（如「新建聊天」）可能与脏工作区不一致。验收桌面 UI 时以当前未提交树为准，或先确认是否与 `main` 已提交桌面一致。
- 未跟踪 `.npmrc`（Electron 镜像）：保留，是否入库由用户决定。
- 本文档线**只动** `docs/` 与 `scripts/`（及必要时根 `package.json` 的轻量脚本入口），不改 `apps/api|worker|computer|desktop` 业务源码。

## 已知缺口

1. 模型凭据仅环境变量；管理页 UI / DB 凭据表、预算与审批、记忆与 Skills 仍未做。
2. Computer 无宿主机端口，宿主机无法直接 `curl :8080`；只能靠 healthcheck 的 `compose exec` 或经 API/Worker。
3. 完整 `pnpm test` 依赖本机隔离测试 Postgres（`55432`）；未起测库会失败。
4. 桌面 UI 与 E2E 可能因未提交改动不同步；`pnpm e2e` 通过不代表脏工作区 UI 已验收。
5. 阶段 2 之后的终端、公网/云部署均未纳入本 Compose。
6. `--file-demo` 依赖 Worker→Computer 内网；若任务 SSE 终态为 `task.failed`（例如 `COMPUTER_UNAVAILABLE`），冒烟会 exit `1`（不必等到超时）。先 `pnpm healthcheck`。

## 相关文件

- 启动说明：`README.zh-CN.md`
- Compose：`compose.yaml`
- 健康检查：`scripts/dev-healthcheck.mjs`（`pnpm healthcheck`）
- API 冒烟：`scripts/dev-smoke.mjs`（`pnpm smoke`）
- 设计/计划：`docs/superpowers/specs/`、`docs/superpowers/plans/`
