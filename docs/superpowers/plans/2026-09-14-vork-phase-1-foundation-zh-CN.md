# Vork 第一阶段：基础设施与对话式创建 Bot 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 构建一个可运行的 Electron 开发版，让单用户通过 `+ -> 新聊天 -> 创建新 Bot` 创建 Bot、发送消息，并通过持久事件流接收后台 Worker 的确定性流式回复。

**架构：** 使用 pnpm workspace 管理 Electron、API 和 Worker；共享 Zod 契约保证 IPC、HTTP 与事件类型一致。PostgreSQL 保存 Bot、对话、消息、任务和只追加事件，Redis/BullMQ 负责排队；第一阶段使用确定性 FakeModel，不接入真实模型或云电脑工具。

**技术栈：** TypeScript、Node.js 22+、pnpm 10+、Electron、React、Vite、Fastify、Zod、Drizzle ORM、PostgreSQL、Redis、BullMQ、Vitest、Playwright。

**规格：** `docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md`

## 全局约束

- 第一阶段仅支持单用户，但所有业务表保留 `user_id`。
- Electron 必须设置 `contextIsolation: true`、`nodeIntegration: false`。
- Renderer 不得直接访问 Node.js、文件系统、Shell 或 Secret。
- 所有跨进程和跨服务输入都必须通过 Zod 运行时校验。
- PostgreSQL 是业务事实来源；Redis 只保存队列和临时状态。
- 任务事件只追加不修改，并使用单调递增游标。
- 日志不得记录密码、Token、Cookie 或完整消息正文。
- 第一阶段不实现真实模型、浏览器、终端、文件工具、记忆、Skills、审批和多 Bot 委派。
- 每项任务按测试先行完成，并在通过该任务测试后独立提交。

---

## 文件结构

```text
package.json                         workspace 命令和 Node/pnpm 约束
pnpm-workspace.yaml                  workspace 包范围
tsconfig.base.json                   共享 TypeScript 严格配置
.gitignore                           构建、环境和本地数据忽略规则
.env.example                         非敏感环境变量说明
compose.yaml                         PostgreSQL、Redis、API、Worker 开发服务
apps/api/                            HTTP、SSE、单用户请求上下文和业务路由
apps/worker/                         BullMQ 消费者和 FakeModel 任务执行
apps/desktop/                        Electron Main、Preload 与 React Renderer
packages/contracts/                  Zod DTO、事件和队列负载
packages/database/                   Drizzle Schema、迁移和 Repository
packages/test-support/               测试数据库、Redis 和固定数据工具
tests/e2e/                           Electron 端到端测试
```

## Task 1：建立 monorepo 与共享契约

**文件：**
- 创建：`package.json`
- 创建：`pnpm-workspace.yaml`
- 创建：`tsconfig.base.json`
- 创建：`.gitignore`
- 创建：`.env.example`
- 创建：`packages/contracts/package.json`
- 创建：`packages/contracts/tsconfig.json`
- 创建：`packages/contracts/src/index.ts`
- 创建：`packages/contracts/src/bot.ts`
- 创建：`packages/contracts/src/conversation.ts`
- 创建：`packages/contracts/src/task.ts`
- 测试：`packages/contracts/src/contracts.test.ts`

**接口：**
- 产出：`BotSchema`、`CreateBotInputSchema`、`ConversationSchema`、`MessageSchema`、`TaskSchema`、`TaskEventSchema`、`TaskJobSchema`。
- 产出：从以上 Schema 推导的同名 TypeScript 类型。
- 依赖：无。

- [ ] **Step 1：写契约失败测试**

```ts
import { describe, expect, it } from "vitest";
import { CreateBotInputSchema, TaskEventSchema } from "./index";

describe("contracts", () => {
  it("rejects a blank Bot name", () => {
    expect(CreateBotInputSchema.safeParse({ name: "", persona: "Research" }).success).toBe(false);
  });

  it("accepts an ordered task event", () => {
    const result = TaskEventSchema.parse({
      id: "evt_1",
      taskId: "task_1",
      sequence: 1,
      type: "message.delta",
      payload: { text: "hello" },
      createdAt: "2026-09-14T00:00:00.000Z"
    });
    expect(result.sequence).toBe(1);
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

运行：`pnpm --filter @vork/contracts test`

预期：失败，提示 `./index` 或导出的 Schema 不存在。

- [ ] **Step 3：添加 workspace 配置和最小契约实现**

在根 `package.json` 声明 `private: true`、`packageManager`、Node `>=22`，并提供 `test`、`typecheck`、`lint`、`dev` 命令。`TaskEventSchema` 的 `sequence` 使用正整数；时间字段使用 ISO datetime；ID 使用非空字符串；`CreateBotInputSchema` 要求 `name` 与 `persona` 均为去除首尾空格后的非空字符串。`TaskJobSchema` 固定为：

```ts
export const TaskJobSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1),
  botId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1)
});
```

- [ ] **Step 4：运行契约测试和类型检查**

运行：`pnpm --filter @vork/contracts test && pnpm --filter @vork/contracts typecheck`

预期：全部通过。

- [ ] **Step 5：提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example packages/contracts
git commit -m "build: initialize Vork workspace and contracts"
```

## Task 2：建立 PostgreSQL Schema 与 Repository

**文件：**
- 创建：`packages/database/package.json`
- 创建：`packages/database/drizzle.config.ts`
- 创建：`packages/database/src/client.ts`
- 创建：`packages/database/src/schema.ts`
- 创建：`packages/database/src/repositories.ts`
- 创建：`packages/database/src/index.ts`
- 创建：`packages/database/migrations/0001_foundation.sql`
- 创建：`packages/test-support/package.json`
- 创建：`packages/test-support/src/database.ts`
- 测试：`packages/database/src/repositories.integration.test.ts`

**接口：**
- 消费：`CreateBotInput`、`TaskEvent`。
- 产出：`createBot(input)`、`listBots(userId)`、`createConversation(input)`、`appendMessage(input)`、`createTask(input)`、`getTask(taskId)`、`appendTaskEvent(input)`、`listTaskEvents(taskId, afterSequence)`、`failTask(taskId, errorCode)`、`completeTaskWithMessage(input)`。

- [ ] **Step 1：写 Repository 集成测试**

```ts
it("persists a Bot, conversation, task and ordered events", async () => {
  const bot = await repos.createBot({ userId: "user_local", name: "新建 Bot", persona: "待设置" });
  const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
  const message = await repos.appendMessage({ conversationId: conversation.id, authorType: "user", content: "你好" });
  const task = await repos.createTask({ userId: "user_local", botId: bot.id, conversationId: conversation.id, messageId: message.id });
  await repos.appendTaskEvent({ taskId: task.id, type: "task.queued", payload: {} });
  await repos.appendTaskEvent({ taskId: task.id, type: "task.running", payload: {} });
  const events = await repos.listTaskEvents(task.id, 0);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
});
```

- [ ] **Step 2：启动测试数据库并确认测试失败**

运行：`docker compose up -d postgres && pnpm --filter @vork/database test:integration`

预期：失败，提示迁移、表或 Repository 尚不存在。

- [ ] **Step 3：实现表和事务边界**

迁移创建 `users`、`bots`、`conversations`、`conversation_members`、`messages`、`tasks` 和 `task_events`。所有主键使用应用生成的字符串 ID；`task_events` 对 `(task_id, sequence)` 建唯一索引。`appendTaskEvent` 在事务中锁定任务行、读取并递增 `last_event_sequence`，然后插入事件。

- [ ] **Step 4：运行迁移、集成测试和类型检查**

运行：`pnpm --filter @vork/database db:migrate && pnpm --filter @vork/database test:integration && pnpm --filter @vork/database typecheck`

预期：迁移成功，测试和类型检查通过。

- [ ] **Step 5：提交**

```bash
git add packages/database packages/test-support
git commit -m "feat: add foundation persistence layer"
```

## Task 3：实现 Bot、对话和消息 API

**文件：**
- 创建：`apps/api/package.json`
- 创建：`apps/api/src/app.ts`
- 创建：`apps/api/src/server.ts`
- 创建：`apps/api/src/plugins/request-context.ts`
- 创建：`apps/api/src/routes/bots.ts`
- 创建：`apps/api/src/routes/conversations.ts`
- 创建：`apps/api/src/services/chat-service.ts`
- 测试：`apps/api/src/routes/bots.test.ts`
- 测试：`apps/api/src/routes/conversations.test.ts`

**接口：**
- 消费：Task 1 契约与 Task 2 Repository。
- 产出：`GET /v1/bots`、`POST /v1/bots`、`POST /v1/conversations`、`GET /v1/conversations/:id/messages`、`POST /v1/conversations/:id/messages`。
- 产出：`buildApp(deps: ApiDependencies): FastifyInstance`，供测试和服务启动复用。

- [ ] **Step 1：写 API 失败测试**

```ts
it("creates a temporary Bot and conversation", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/bots",
    payload: { name: "新建 Bot", persona: "待通过对话设置" }
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ bot: { name: "新建 Bot" }, conversation: {} });
});
```

消息接口测试必须验证：空消息返回 400；成功提交返回 `202`，同时持久化 user message、queued task 和 `task.queued` 事件。

- [ ] **Step 2：运行路由测试并确认失败**

运行：`pnpm --filter @vork/api test`

预期：失败，提示 `buildApp` 或路由不存在。

- [ ] **Step 3：实现路由与原子聊天事务**

所有请求临时映射到固定 `user_local`，但 Service 和 Repository 必须显式接收 `userId`。`POST /messages` 在同一数据库事务中写入消息、任务和首个事件，事务提交后再发布 BullMQ job；发布失败时将任务标记为 `failed` 并追加 `task.failed` 事件。

- [ ] **Step 4：运行 API 测试和类型检查**

运行：`pnpm --filter @vork/api test && pnpm --filter @vork/api typecheck`

预期：全部通过。

- [ ] **Step 5：提交**

```bash
git add apps/api
git commit -m "feat: add Bot and conversation API"
```

## Task 4：实现 BullMQ Worker 与确定性 FakeModel

**文件：**
- 创建：`apps/worker/package.json`
- 创建：`apps/worker/src/index.ts`
- 创建：`apps/worker/src/queue.ts`
- 创建：`apps/worker/src/model.ts`
- 创建：`apps/worker/src/fake-model.ts`
- 创建：`apps/worker/src/run-chat-task.ts`
- 测试：`apps/worker/src/run-chat-task.test.ts`
- 测试：`apps/worker/src/worker.integration.test.ts`

**接口：**
- 消费：`TaskJob` 与数据库 Repository。
- 产出：`type ModelInput = { botId: string; conversationId: string; userMessage: string }`。
- 产出：`ModelProvider.streamReply(input: ModelInput): AsyncIterable<string>`。
- 产出：`runChatTask(job: TaskJob, deps: { repos: Repositories; model: ModelProvider; notifier: TaskNotifier }): Promise<void>`，追加 `task.running`、多个 `message.delta`、`message.completed` 和 `task.completed` 事件。

- [ ] **Step 1：写 Worker 失败测试**

```ts
it("streams ordered deltas and completes the task", async () => {
  await runChatTask(job, { repos, model: new FakeModel(["你好，", "我是 Vork。"]) });
  const events = await repos.listTaskEvents(job.taskId, 0);
  expect(events.map((event) => event.type)).toEqual([
    "task.queued",
    "task.running",
    "message.delta",
    "message.delta",
    "message.completed",
    "task.completed"
  ]);
});
```

- [ ] **Step 2：运行测试并确认失败**

运行：`pnpm --filter @vork/worker test`

预期：失败，提示 `runChatTask` 或 `FakeModel` 不存在。

- [ ] **Step 3：实现 FakeModel 和幂等 Worker**

`FakeModel` 根据输入消息返回固定分片。`runChatTask` 开始前通过 `getTask(taskId)` 读取任务终态；已完成、失败或取消的任务直接返回。每个 delta 都先追加事件，再发布实时通知。完成时调用 `completeTaskWithMessage(input)`，在事务中写入 assistant message、`message.completed` 和 `task.completed`。异常时调用 `failTask(taskId, errorCode)` 追加脱敏后的 `task.failed`，不得记录完整用户消息。

- [ ] **Step 4：运行单元、集成测试与类型检查**

运行：`pnpm --filter @vork/worker test && pnpm --filter @vork/worker test:integration && pnpm --filter @vork/worker typecheck`

预期：全部通过，重复消费同一 job 不产生第二条 assistant message。

- [ ] **Step 5：提交**

```bash
git add apps/worker
git commit -m "feat: add queued fake-model chat worker"
```

## Task 5：实现可恢复的 SSE 任务事件流

**文件：**
- 创建：`apps/api/src/routes/task-events.ts`
- 创建：`apps/api/src/services/event-stream.ts`
- 创建：`apps/api/src/test/open-sse.ts`
- 修改：`apps/api/src/app.ts`
- 修改：`apps/worker/src/run-chat-task.ts`
- 测试：`apps/api/src/routes/task-events.test.ts`

**接口：**
- 消费：`listTaskEvents(taskId, afterSequence)`。
- 产出：`GET /v1/tasks/:taskId/events?after=<sequence>`，响应类型为 `text/event-stream`。
- 产出：每条 SSE 的 `id` 等于事件 sequence，`event` 等于事件 type，`data` 为 `TaskEvent` JSON。
- 产出：测试辅助函数 `openSse(app, url, eventCount): Promise<{ events: SseEvent[] }>`，读取指定数量事件后主动关闭连接。

- [ ] **Step 1：写断线续传失败测试**

```ts
it("replays only events after the supplied cursor", async () => {
  await seedTaskEvents(taskId, ["task.queued", "task.running", "message.delta"]);
  const response = await openSse(`/v1/tasks/${taskId}/events?after=1`);
  expect(response.events.map((event) => event.id)).toEqual(["2", "3"]);
});
```

- [ ] **Step 2：运行测试并确认失败**

运行：`pnpm --filter @vork/api test -- task-events.test.ts`

预期：404 或事件流路由不存在。

- [ ] **Step 3：实现数据库回放与 Redis 唤醒**

连接建立后先从 PostgreSQL 回放 `after` 之后的事件，再订阅 Redis 的 task notification channel。Redis 消息只作为“有新数据”的提示；收到提示后重新从 PostgreSQL 按最后 sequence 拉取。每 20 秒发送 SSE comment 心跳。客户端断开时必须释放订阅。

- [ ] **Step 4：运行事件流、API 和 Worker 测试**

运行：`pnpm --filter @vork/api test && pnpm --filter @vork/worker test`

预期：全部通过，重复 Redis 通知不会导致重复 SSE 事件。

- [ ] **Step 5：提交**

```bash
git add apps/api apps/worker
git commit -m "feat: add resumable task event stream"
```

## Task 6：建立安全 Electron Shell 与 Preload API

**文件：**
- 创建：`apps/desktop/package.json`
- 创建：`apps/desktop/electron.vite.config.ts`
- 创建：`apps/desktop/src/main/index.ts`
- 创建：`apps/desktop/src/main/window.ts`
- 创建：`apps/desktop/src/preload/index.ts`
- 创建：`apps/desktop/src/preload/api.ts`
- 创建：`apps/desktop/src/renderer/index.html`
- 创建：`apps/desktop/src/renderer/src/main.tsx`
- 创建：`apps/desktop/src/renderer/src/App.tsx`
- 创建：`apps/desktop/src/renderer/src/vork-api.d.ts`
- 测试：`apps/desktop/src/main/window.test.ts`
- 测试：`apps/desktop/src/preload/api.test.ts`

**接口：**
- 产出：`createMainWindow(): BrowserWindow`。
- 产出：`window.vorkApi.request(input)` 与 `window.vorkApi.subscribeTask(taskId, afterSequence, listener)`。
- 消费：Task 1 的请求、响应和事件 Schema。

- [ ] **Step 1：写 Electron 安全配置失败测试**

```ts
it("creates an isolated renderer without Node integration", () => {
  const options = buildWindowOptions();
  expect(options.webPreferences?.contextIsolation).toBe(true);
  expect(options.webPreferences?.nodeIntegration).toBe(false);
  expect(options.webPreferences?.sandbox).toBe(true);
});
```

Preload 测试必须验证未知 channel 被拒绝，Renderer 不能传入任意 URL 或 IPC channel。

- [ ] **Step 2：运行测试并确认失败**

运行：`pnpm --filter @vork/desktop test`

预期：失败，提示窗口配置或 Preload API 不存在。

- [ ] **Step 3：实现 Main、Preload 和空 Renderer**

Main 创建单一窗口并拦截 `will-navigate`、`setWindowOpenHandler`。Preload 使用 `contextBridge` 暴露固定 API；所有输入和返回值用共享 Zod Schema 校验。开发环境 API 基址来自 Main 进程允许列表，不允许 Renderer 覆盖为任意地址。

- [ ] **Step 4：运行 Electron 测试、类型检查和开发构建**

运行：`pnpm --filter @vork/desktop test && pnpm --filter @vork/desktop typecheck && pnpm --filter @vork/desktop build`

预期：全部通过并产生可启动的开发构建。

- [ ] **Step 5：提交**

```bash
git add apps/desktop
git commit -m "feat: add secure Electron application shell"
```

## Task 7：实现 Grok Bot 风格的新聊天与对话界面

**文件：**
- 创建：`apps/desktop/src/renderer/src/features/navigation/Sidebar.tsx`
- 创建：`apps/desktop/src/renderer/src/features/chat/NewChatRecipientPicker.tsx`
- 创建：`apps/desktop/src/renderer/src/features/chat/ConversationView.tsx`
- 创建：`apps/desktop/src/renderer/src/features/chat/MessageComposer.tsx`
- 创建：`apps/desktop/src/renderer/src/features/chat/useConversation.ts`
- 创建：`apps/desktop/src/renderer/src/test/fake-vork-api.ts`
- 创建：`apps/desktop/src/renderer/src/styles/app.css`
- 修改：`apps/desktop/src/renderer/src/App.tsx`
- 测试：`apps/desktop/src/renderer/src/features/chat/NewChatRecipientPicker.test.tsx`
- 测试：`apps/desktop/src/renderer/src/features/chat/useConversation.test.tsx`

**接口：**
- 消费：`window.vorkApi.request`、`window.vorkApi.subscribeTask`。
- 产出：`NewChatRecipientPicker({ bots, onCreateBot, onSelectBot })`。
- 产出：`useConversation(conversationId)`，返回 messages、activeTask、sendMessage 和 connectionState。
- 产出：`createFakeVorkApi()`，为 Renderer 测试提供类型完整的内存实现。

- [ ] **Step 1：写创建 Bot 交互失败测试**

```tsx
import { createFakeVorkApi } from "../../test/fake-vork-api";

it("opens the recipient picker and creates a temporary Bot", async () => {
  const fakeApi = createFakeVorkApi();
  render(<App api={fakeApi} />);
  await user.click(screen.getByRole("button", { name: "新建聊天" }));
  expect(screen.getByRole("combobox", { name: "收件人" })).toBeVisible();
  await user.click(screen.getByRole("option", { name: "创建新 Bot" }));
  expect(fakeApi.createBot).toHaveBeenCalledWith({ name: "新建 Bot", persona: "待通过对话设置" });
  expect(await screen.findByRole("heading", { name: "新建 Bot" })).toBeVisible();
});
```

- [ ] **Step 2：运行 Renderer 测试并确认失败**

运行：`pnpm --filter @vork/desktop test -- NewChatRecipientPicker.test.tsx`

预期：失败，提示组件或交互不存在。

- [ ] **Step 3：实现已确认的简洁界面**

左栏只展示搜索、Bot/对话、顶部 `+` 和底部用户身份。`+` 将主标题替换为收件人 combobox；选择“创建新 Bot”后立即调用 API、把新 Bot 插入列表并打开空对话。实时执行面板不出现在第一阶段 UI，只保留后续阶段使用的 header action slot。任务事件按 sequence 合并 delta；重连使用最后 sequence。

- [ ] **Step 4：运行组件测试、可访问性检查和构建**

运行：`pnpm --filter @vork/desktop test && pnpm --filter @vork/desktop typecheck && pnpm --filter @vork/desktop build`

预期：全部通过；键盘可打开收件人选择器并选择“创建新 Bot”。

- [ ] **Step 5：提交**

```bash
git add apps/desktop/src/renderer
git commit -m "feat: add conversational Bot creation UI"
```

## Task 8：完成 Docker Compose 与端到端验收

**文件：**
- 创建：`compose.yaml`
- 创建：`infra/docker/api.Dockerfile`
- 创建：`infra/docker/worker.Dockerfile`
- 创建：`tests/e2e/package.json`
- 创建：`tests/e2e/playwright.config.ts`
- 创建：`tests/e2e/fixtures.ts`
- 创建：`tests/e2e/bot-chat.spec.ts`
- 创建：`scripts/dev-healthcheck.mjs`
- 创建：`README.zh-CN.md`
- 修改：`package.json`
- 修改：`.env.example`

**接口：**
- 消费：API、Worker、Electron 和数据库接口。
- 产出：`docker compose up --build` 可启动 PostgreSQL、Redis、API 和 Worker。
- 产出：根命令 `pnpm test`、`pnpm typecheck`、`pnpm e2e` 和 `pnpm dev`。

- [ ] **Step 1：写端到端失败测试**

```ts
import { expect, test } from "./fixtures";

test("creates a Bot and receives a resumable streamed reply", async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  await window.getByRole("button", { name: "新建聊天" }).click();
  await window.getByRole("option", { name: "创建新 Bot" }).click();
  await window.getByRole("textbox", { name: "消息" }).fill("你好");
  await window.getByRole("button", { name: "发送" }).click();
  await expect(window.getByText("你好，我是 Vork。")).toBeVisible();
  await electronApp.close();
  const restarted = await launchVork();
  await expect((await restarted.firstWindow()).getByText("你好，我是 Vork。")).toBeVisible();
});
```

`tests/e2e/fixtures.ts` 导出扩展后的 Playwright `test`、`expect` 和 `launchVork()`。`electronApp` fixture 通过 Playwright `_electron.launch` 启动构建后的 Main 入口，并在每个测试后关闭进程；`launchVork()` 使用同一数据目录重新启动应用，以验证重启持久化。

- [ ] **Step 2：运行 E2E 并确认失败**

运行：`docker compose up -d --build && pnpm e2e`

预期：失败，因为 Compose、健康检查或完整桌面流程尚未连通。

- [ ] **Step 3：完成开发部署、健康检查和中文启动文档**

Compose 为 PostgreSQL 和 Redis 配置健康检查，为 API/Worker 设置 `depends_on: condition: service_healthy`，使用命名卷保存数据库。`dev-healthcheck.mjs` 必须检查 API、PostgreSQL、Redis 和 Worker 心跳。README 写明环境变量、迁移、启动、测试、日志和清理命令；不得包含真实 Secret。

- [ ] **Step 4：运行完整验证**

运行：

```bash
pnpm test
pnpm typecheck
pnpm --filter @vork/desktop build
docker compose up -d --build
node scripts/dev-healthcheck.mjs
pnpm e2e
docker compose down
git diff --check
```

预期：所有测试、类型检查、构建、健康检查和 E2E 通过；`docker compose down` 后数据库命名卷仍存在；`git diff --check` 无输出。

- [ ] **Step 5：提交**

```bash
git add compose.yaml infra tests scripts README.zh-CN.md package.json .env.example
git commit -m "feat: complete Vork foundation vertical slice"
```

## 第一阶段验收结果

完成本计划后，应获得以下可独立验证的软件：

- 可启动的安全 Electron 客户端。
- 与已确认 Grok Bot 流程一致的新聊天和对话式 Bot 创建。
- 持久化 Bot、对话、消息、任务和事件。
- BullMQ 后台任务和确定性流式 FakeModel 回复。
- 断线后按事件游标恢复的 SSE。
- PostgreSQL、Redis、API 和 Worker 的本地 Compose 环境。
- 覆盖创建、聊天、流式回复和重启持久化的端到端测试。
