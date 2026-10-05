# vork-bot

Vork 是一个个人使用的 AI Bot 桌面应用。你可以创建不同职责的 Bot，通过聊天让它操作云端浏览器、终端和文件，也可以设置定时任务。

当前版本面向**单用户本地开发与自用**，桌面客户端基于 Electron。默认通过 OpenAI Agents SDK 编排 Agent，使用 DeepSeek 模型；不需要 OpenAI API Key。

> 这是开发配置，不是生产部署方案。不要将 API、数据库或 Computer 服务直接暴露到公网。

## 功能与边界

| 模块 | 当前能力 |
| --- | --- |
| Bot 与对话 | 创建、配置 Bot，聊天与历史记录；同一用户的 Bot 名称不区分大小写唯一 |
| Agent | 自然语言问答、连续会话、流式回复、工具调用；状态保存在 PostgreSQL |
| 文件 | 读取、写入、列目录、查询信息、创建目录、移动和删除 |
| 终端 | 启动、输入、读取增量输出和终止会话 |
| 浏览器 | 打开页面、观察标题及可交互元素、点击、输入、滚动 |
| 电脑面板 | 按需展开 JPEG 画面，支持人工接管；默认隐藏 |
| 执行安全 | 风险操作审批、取消、检查点与恢复机制；不自动重做结果不确定的副作用 |
| 定时任务 | 单次、每日、每周、五段 Cron；暂停、恢复、立即运行和运行历史 |
| 模型配置 | `.env` 或桌面“模型凭据”设置；支持 OpenAI-compatible 模型入口 |

当前不包含完整 Linux 桌面环境、生产级多用户隔离、通知渠道和多 Agent 协作调度。Skills 自动总结经验也尚未完成。

浏览器联网**不等同于 OpenAI 托管 web_search**。当前页面观察主要提供标题和可交互元素，不是完整正文提取器；复杂页面、登录要求、验证码和网站反自动化机制会影响效果。

## 架构

Electron 客户端通过 API 创建任务、读取历史和订阅事件；Worker 从 BullMQ 队列接收任务，调用模型，并通过 Computer 服务执行工具。

| 服务 | 职责 |
| --- | --- |
| Desktop | Electron + React 界面、IPC 与 API 客户端 |
| API | Bot、对话、任务、审批和管理接口；SSE 任务事件 |
| Worker | Agents SDK、DeepSeek、工具编排、任务恢复及定时任务扫描 |
| Computer | Playwright 浏览器、终端、文件工作区、槽位与人工接管 |
| PostgreSQL | 对话、任务事件、审批、执行状态与长期计划的持久化 |
| Valkey | Redis-compatible 队列与事件通知，配合 BullMQ 使用 |

纯问答不占用 Computer 槽位。第一次执行电脑工具时申请槽位，同一轮复用，结束后释放。默认最多 3 个槽位，其中浏览器槽位最多 2 个；这不是每个 Bot 一台独立 Docker 虚拟机。

## 环境要求

- 当前本地开发流程主要在 macOS 上验证。
- Node.js 22 或更高版本。
- pnpm：仓库固定版本为 `10.33.0`，优先使用 `package.json` 中的版本。
- Docker Desktop 或可用的 Docker Engine 与 Compose。
- 可用的 DeepSeek API Key、模型权限与余额。

Compose 的 Computer 默认限制为 4 GB 内存、2 CPU。运行整套开发栈需要为 Docker 留出额外的数据库和 Worker 资源。

## 快速开始

### 1. 获取代码并安装依赖

```sh
git clone git@github.com:skyiimaple/vork-bot.git
cd vork-bot
pnpm install
cp .env.example .env
```

已有 `.env` 时不要重复复制覆盖。仓库内各子包仍使用 `@vork/*` 名称，这是内部包命名，不影响仓库名称。

### 2. 配置 DeepSeek

编辑 `.env`，填写自己的密钥：

```dotenv
LLM_API_KEY=你的DeepSeek密钥
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
VORK_AGENT_RUNTIME=agents-sdk
```

模型名须在你的服务账号中可用；如不可用，改为账号支持的模型。也可以在桌面左下角用户菜单中的“模型凭据”配置，桌面保存的值优先，并在下一次任务时读取。

默认 SDK 路径关闭 DeepSeek thinking 模式以兼容工具调用历史，并关闭 OpenAI tracing。没有配置任何有效模型密钥时会退回本地 FakeModel；它是开发演示，不代表真实 AI 能力。

### 3. 启动后台与桌面

首次运行或镜像需要同步源码时：

```sh
docker compose up -d --build
pnpm healthcheck
pnpm dev
```

镜像已经与源码一致时，无需重建：

```sh
docker compose up -d --no-build
pnpm healthcheck
pnpm dev
```

Compose 自动运行数据库迁移，再启动 API 与 Worker。健康检查确认 API、PostgreSQL、Valkey、Worker 和 Computer 就绪；`pnpm dev` 启动 Electron 开发客户端。

### 4. 试用

创建一个 Bot 并设置名称、职责，然后直接聊天，例如：

- “创建 hello.txt，写入你好，再读取给我。”
- “通过终端运行 pwd，告诉我输出。”
- “打开 https://example.com，告诉我页面标题。”
- “删除 hello.txt。”——删除操作应先等待你批准。

不需要输入内部 demo 标记。对话标题栏的“电脑”用于展开执行画面，默认折叠。

## 常用配置

| 变量 | 用途 |
| --- | --- |
| `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` | 默认模型密钥、服务地址和模型名 |
| `VORK_AGENT_RUNTIME` | 默认 `agents-sdk`；可显式选择 `legacy` 或 `openai-agents` |
| `VORK_MODEL_PROVIDER=fake` | 强制使用开发演示模型 |
| `LLM_TIMEOUT_MS` | 模型请求超时，默认 60000 毫秒 |
| `VORK_DB_PASSWORD` | Compose 数据库密码；初始开发值为 `vork_dev_only` |
| `DATABASE_URL` | 主机侧数据库连接，通常指向 `127.0.0.1:5432/vork` |
| `VORK_COMPUTER_TOKEN` | API/Worker 调用 Computer 的认证令牌 |
| `VORK_API_BASE_URL` | 桌面及开发脚本访问 API 的地址 |
| `VORK_ROUTINE_SCAN_INTERVAL_MS` | Worker 定时任务扫描间隔，默认 5000 毫秒 |

默认 SDK 单次任务最多 30 个模型回合、最长 5 分钟。修改 `.env` 的模型配置后，执行 `docker compose up -d --no-deps --no-build worker` 让容器加载新值；只执行 `restart` 不会更新容器环境变量。

`.env.example` 提供开发默认值，不要提交真实密钥。已初始化的 PostgreSQL 卷不会因为修改环境变量就自动修改数据库用户密码。

`legacy` 为原有本地 Agent 路径。`openai-agents` 为可选的 OpenAI 托管路径，另需配置 `OPENAI_API_KEY`、`OPENAI_AGENT_MODEL`，并具备相应服务权限和余额；DeepSeek Key 不能作为该托管服务的 OpenAI Key。

## 定时任务

从左下角用户菜单进入“定时任务”，选择 Bot、填写任务内容，再选择单次、每日、每周或高级 Cron，并指定 IANA 时区，例如 `Asia/Shanghai`。

- 每个定时任务绑定一个专属对话，历次结果追加到同一对话。
- 支持编辑、暂停、恢复、立即运行与软删除；删除保留专属对话和历史。
- Worker 重启后，错过多个周期最多补一次，额外错过次数记录为 `missedCount`。
- 同一计划不并发执行；前一次未结束时，新周期记录为 `skipped_overlap`。
- Cron 为分钟精度的标准五段表达式，不支持秒级调度。

桌面关闭后，只要后台 Worker 和数据库仍运行，计划可以继续执行。停止后台期间不会实时触发计划。

## 测试与开发

测试会清理专用数据库，必须使用独立的 `*_test` 数据库，**不能指向个人开发数据所在的 `vork`**。

首次准备测试数据库（以下使用默认开发密码；如已修改请对应调整）：

```sh
docker compose up -d postgres redis
docker compose exec postgres createdb -U vork vork_test
export VORK_TEST_DATABASE_URL=postgres://vork:vork_dev_only@127.0.0.1:5432/vork_test
DATABASE_URL="$VORK_TEST_DATABASE_URL" pnpm --filter @vork/database db:migrate
```

数据库已存在时跳过 `createdb`。随后按需执行：

```sh
pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
```

`pnpm e2e` 需要已启动的 Compose 栈和构建后的 Electron 入口，会操作应用、创建测试数据；不要当作无副作用的健康检查。

`pnpm smoke` 是 API 冒烟测试，也会创建 Bot/对话并发送任务，使用真实模型时可能计费。`deepseek.real.test.ts` 默认跳过，只有显式设置 `VORK_REAL_DEEPSEEK_TEST=1` 才运行；还需要专用测试库及测试文件中约定的临时 Computer 服务。

### 仓库结构

```text
apps/desktop/       Electron 桌面客户端
apps/api/           HTTP API 与 SSE
apps/worker/        Agent、工具执行与调度
apps/computer/      浏览器、文件、终端服务
packages/contracts/共享协议与校验
packages/database/ 数据模型、仓储与迁移
packages/test-support/ 测试数据库工具
infra/docker/      容器构建文件
scripts/           健康检查、冒烟与 UI 检查
tests/e2e/         Electron 端到端测试
docs/              设计、计划与中文交接记录
```

## 故障排查

```sh
pnpm healthcheck
docker compose ps -a
docker compose logs --tail=100 api worker computer migrate
```

| 现象 | 检查方向 |
| --- | --- |
| 后台不可达 | Docker 是否启动、3000/5432/6379 端口是否被占用、迁移是否完成 |
| 密钥错误或限流 | 桌面凭据是否覆盖 `.env`、模型名、服务权限、余额和限流 |
| 只返回演示回复 | 是否缺少模型密钥，或设置了 `VORK_MODEL_PROVIDER=fake` |
| 等待审批 | 在应用中批准或拒绝，不要重复发送同一破坏性操作 |
| 网站打不开或内容不足 | 网络、登录/验证码、网页可读内容及浏览器工具的能力边界 |
| 代码修改后行为没变 | 对应服务镜像是否已重建并重新创建容器 |

部分执行异常目前仍显示统一的失败提示，不能仅凭“检查模型及电脑连接”判断根因，应结合任务事件、工具状态和日志。

## 关闭与数据保留

关闭 Electron，并在运行 `pnpm dev` 的终端按 `Ctrl+C`。停止后台：

```sh
docker compose stop
```

`docker compose down` 会移除项目容器和网络，但默认保留命名卷。**不要执行 `docker compose down -v`，除非明确要清空数据库、工作区和浏览器数据。**

项目目录虽已改为 `vork-bot`，Compose 内部项目名仍固定为 `vorkbot`，用于沿用已有资源：

- `vorkbot_postgres_data`：数据库。
- `vorkbot_workspace_data`：Bot 文件工作区。
- `vorkbot_browser_profiles`：浏览器 Profile。

密钥、浏览器登录信息与聊天历史均需按个人敏感数据保护。当前终端与浏览器能力不应视为生产级安全沙箱。

## 进一步阅读

- [DeepSeek Agents SDK 实施与验收记录](docs/superpowers/plans/2026-10-05-deepseek-agents-sdk-zh-CN.md)
- [定时任务交接说明](docs/handovers/2026-09-30-vork-routines-status-zh-CN.md)
- [整体系统设计](docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md)

历史文档记录的是对应阶段状态；当前启动方式与默认模型以本 README、`compose.yaml` 和源码为准。
