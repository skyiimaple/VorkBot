# Vork 功能版 V1：稳定基线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户明确要求本轮不执行 Git 提交。

**Goal:** 修复当前工作区的编译问题，恢复完整本地服务，并为后续终端、Agent、记忆、Skills 与 Routines 建立可重复验证的干净功能基线。

**Architecture:** 不改变现有 Electron → API → PostgreSQL/Valkey/BullMQ → Worker → Computer 架构。本切片只修复明确回归、恢复服务和补齐验证证据；若测试暴露业务缺陷，先以最小改动修复，不提前实现下一切片功能。

**Tech Stack:** TypeScript 5.9、pnpm 10、Vitest、Electron/Vite、Fastify、PostgreSQL 17、Valkey 8.1、Docker Compose、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-28-vork-functional-v1-design-zh-CN.md`

## Global Constraints

- 不执行 `git commit`、`git reset`、`git checkout --` 或删除用户数据。
- 不执行 `docker compose down -v`；PostgreSQL、工作区和浏览器 Profile 命名卷必须保留。
- 生产部署、Jev、终端、记忆增强、Skills 增强和 Routines 不属于本切片。
- 所有跨进程输入继续使用共享 Zod Schema；Renderer 不得获得 Node、Computer URL 或 token。
- PostgreSQL 是事实来源；Valkey 只承载队列、通知与临时状态。
- 任何修复必须先有可复现的失败命令或测试，再做最小实现。

---

### Task 1: 修复 Electron Renderer 类型回归

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/chat/ConversationView.tsx:105-110`
- Verify: `apps/desktop/src/renderer/src/features/chat/*.test.tsx`

**Interfaces:**
- Consumes: `messages: Message[]`、`activeTask`、`working`
- Produces: `showStandaloneThinking: boolean`、`showInlineThinking: boolean`，在空消息列表时不解引用 `lastMessage`

- [ ] **Step 1: 复现类型失败**

Run: `pnpm --filter @vork/desktop typecheck`

Expected: FAIL，`ConversationView.tsx` 报 `lastMessage is possibly undefined`。

- [ ] **Step 2: 最小修复类型收窄**

将内联思考条件改为显式分支：

```ts
const showInlineThinking = Boolean(
  working && activeTask && lastMessage?.authorType === "assistant" && lastMessage.content.trim().length === 0
);
```

如果 TypeScript 仍不能跨可选链收窄，则先保存布尔值：

```ts
const lastMessageIsEmptyAssistant =
  lastMessage?.authorType === "assistant" && lastMessage.content.trim().length === 0;
const showInlineThinking = Boolean(working && activeTask && lastMessageIsEmptyAssistant);
```

- [ ] **Step 3: 验证桌面类型与测试**

Run: `pnpm --filter @vork/desktop typecheck && pnpm --filter @vork/desktop test`

Expected: PASS；空消息与 assistant 流式消息测试不回归。

---

### Task 2: 恢复并核验本地 Compose 服务

**Files:**
- Inspect: `compose.yaml`
- Inspect: `scripts/dev-healthcheck.mjs`
- Modify only if reproduced defect requires it: `compose.yaml` or the failing service startup file

**Interfaces:**
- Consumes: existing Docker volumes and `.env`
- Produces: healthy PostgreSQL、Valkey、API、Worker、Computer；migration exits 0

- [ ] **Step 1: 获取当前状态与失败原因**

Run:

```sh
docker compose ps -a
docker compose logs --tail=120 api worker redis migrate
```

Expected: 记录 API 的真实退出原因；不得仅依据旧日志修改代码。

- [ ] **Step 2: 按现有配置重新协调服务**

Run: `docker compose up -d --build`

Expected: migrate 成功退出，其余五个长期服务运行；若 API 再次失败，保留本次启动日志并进入 Step 3。

- [ ] **Step 3: 仅在失败可复现时修复启动缺陷**

如果失败来自依赖未就绪，确保 `api`/`worker` 对 Valkey 使用 `condition: service_healthy`；如果来自应用未处理 Redis 初始断线，在连接构造处注册错误处理并采用有上限重连。不得用无限紧循环或吞掉致命配置错误。

- [ ] **Step 4: 运行健康检查**

Run: `pnpm healthcheck`

Expected: API、PostgreSQL、Valkey、Worker heartbeat 和 Computer 全部 ready。

---

### Task 3: 建立隔离测试数据库并运行集成测试

**Files:**
- Inspect: `packages/test-support/src/database.ts`
- Inspect: `packages/database/migrations/*.sql`
- Modify only for reproduced test defect: affected source/test file

**Interfaces:**
- Consumes: `TEST_DATABASE_URL=postgres://vork:vork_test_only@127.0.0.1:55432/vork_test`
- Produces: 与个人开发库隔离的可清理测试数据库

- [ ] **Step 1: 检查测试数据库容器是否存在**

Run: `docker ps -a --filter name=vork-test-postgres --format '{{.Names}} {{.Status}}'`

- [ ] **Step 2: 在不存在时创建专用容器，存在时只启动**

Create command:

```sh
docker run -d --name vork-test-postgres \
  -e POSTGRES_USER=vork \
  -e POSTGRES_PASSWORD=vork_test_only \
  -e POSTGRES_DB=vork_test \
  -p 127.0.0.1:55432:5432 \
  pgvector/pgvector:pg17
```

Existing command: `docker start vork-test-postgres`

Expected: 只操作名为 `vork-test-postgres` 的隔离容器，不连接 `127.0.0.1:5432/vork` 开发库。

- [ ] **Step 3: 等待测试库 ready 并执行迁移**

Run:

```sh
docker exec vork-test-postgres pg_isready -U vork -d vork_test
TEST_DATABASE_URL='postgres://vork:vork_test_only@127.0.0.1:55432/vork_test' pnpm --filter @vork/database db:migrate
```

Expected: ready；迁移成功且包含 `0001_foundation`、`0002_phase3`。

- [ ] **Step 4: 运行完整非 E2E 测试与类型检查**

Run:

```sh
TEST_DATABASE_URL='postgres://vork:vork_test_only@127.0.0.1:55432/vork_test' pnpm test
pnpm typecheck
```

Expected: 所有 workspace 非 E2E 测试与类型检查通过。失败必须归类为实现缺陷、测试隔离缺陷或环境缺陷，并仅修复真实实现/测试问题。

---

### Task 4: 构建与端到端基线

**Files:**
- Inspect: `tests/e2e/playwright.config.ts`
- Inspect: `tests/e2e/fixtures.ts`
- Inspect: `tests/e2e/*.spec.ts`
- Modify only for reproduced product defect: affected source/test file

**Interfaces:**
- Consumes: healthy Compose stack and built Electron main/preload/renderer
- Produces: 可重复的本地 Electron 基础 E2E 结果

- [ ] **Step 1: 构建 Electron**

Run: `pnpm --filter @vork/desktop build`

Expected: PASS；生成 `apps/desktop/out/main/index.js`、`out/preload/index.cjs` 和 renderer 产物。

- [ ] **Step 2: 运行 API 冒烟**

Run: `pnpm smoke -- --sse --timeout=60000`

Expected: health → 创建 Bot → 发送消息 → SSE 接收非空助手回复成功。

- [ ] **Step 3: 运行 Electron E2E**

Run: `pnpm e2e`

Expected: 创建 Bot、聊天流、重启持久化基础用例通过；browser demo 若仍被配置为推荐非阻塞用例，必须单独报告结果。

- [ ] **Step 4: 最终一致性检查**

Run:

```sh
git diff --check
git status --short
```

Expected: 无空白错误；列出本切片实际修改，不提交 Git。

---

### Task 5: 更新阶段状态文档

**Files:**
- Modify: `README.zh-CN.md`
- Create: `docs/handovers/2026-09-28-vork-functional-v1-foundation-status-zh-CN.md`

**Interfaces:**
- Consumes: Tasks 1–4 的实际命令、结果和已知限制
- Produces: 下一切片可复用的准确基线，不把未运行测试写成通过

- [ ] **Step 1: 记录实际验证矩阵**

交接文档必须逐项记录 typecheck、unit/integration、build、healthcheck、smoke、E2E 的命令、日期与结果，并注明测试数据库和 Compose 状态。

- [ ] **Step 2: 更新 README 的现状说明**

只修正已被本切片证实的启动或测试说明，不提前宣传终端、增强记忆、Skills 或 Routines。

- [ ] **Step 3: 文档自检**

Run:

```sh
rg -n 'TBD|TODO|待补|稍后填写' README.zh-CN.md docs/handovers/2026-09-28-vork-functional-v1-foundation-status-zh-CN.md
git diff --check
```

Expected: 无占位符和空白错误。

## 本切片完成标准

- `pnpm typecheck` 通过。
- 使用隔离测试库的 `pnpm test` 通过。
- Electron build 通过。
- Compose healthcheck 与 API smoke 通过。
- 核心 Electron E2E 通过或有可复现、已解释的外部阻塞。
- 工作区仅包含本切片有意修改，且没有 Git 提交。
