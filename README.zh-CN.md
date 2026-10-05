# Vork 本地开发版

这是单用户的本地开发版：可通过 Electron 创建 Bot、聊天；默认使用 OpenAI Agents SDK 编排 Agent，调用 DeepSeek 模型。会话与执行状态保存在本地 PostgreSQL，不需要 OpenAI API Key。云电脑由 Compose 内独立 `computer` 服务提供文件、浏览器和终端工具、JPEG 画面面板及人工接管状态机。不要将此 Compose 配置直接暴露到公网。

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

默认 Runtime 为 `agents-sdk`。在 `.env` 或桌面“模型凭据”中配置 DeepSeek；桌面保存的凭据优先，并在下一次任务生效：

```sh
LLM_API_KEY=你的DeepSeek密钥
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

SDK 通过 Function Tools 调用 Vork Computer 的文件、终端和浏览器能力。纯问答不会占用 Computer 槽位；第一次调用 Computer 工具时才申请，同一轮后续工具复用该槽位，结束后自动释放。DeepSeek 当前关闭 thinking 模式以兼容 SDK 的工具调用历史，关闭 OpenAI tracing，不向 OpenAI 上传运行追踪。

SDK 路径不提供 OpenAI 托管的 `web_search`：联网依靠云端浏览器，页面可读内容及网站限制会影响效果，不保证任意网站均可搜索或读取。每轮最多 30 个模型回合、最长 5 分钟。

- `[file-demo]`：写入并读取演示文件。
- `[browser-demo]`：在自建测试页执行 observe/click/type。
- 对话标题栏“电脑”：按需展开 JPEG 画面；默认折叠，折叠后停止轮询。
- Agents 可直接选择读取或写入文件、运行终端命令，以及导航、观察、点击、输入和滚动浏览器，无需用户输入内部测试标记。
- 文件删除/移动、敏感写入及联网安装类终端命令进入 `waiting_approval`；批准后恢复 SDK 状态，沿用原始工具调用 ID 继续任务。已成功工具的结果持久化，恢复时复用；结果不确定的副作用不会自动重做。
- 方括号形式的 demo 标记只为旧 Runtime 和自动化测试保留，不是正常产品操作方式。

需要使用旧 Runtime 时可设置 `VORK_AGENT_RUNTIME=legacy`。若要显式切回 OpenAI 托管 Agents API，则另行配置有权限和余额的 OpenAI 项目密钥：

```sh
VORK_AGENT_RUNTIME=openai-agents
OPENAI_API_KEY=你的OpenAI密钥
OPENAI_AGENT_MODEL=gpt-6-astra
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
