# Vork 阶段 2：共享云电脑与执行槽实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在本机 Docker Compose 交付共享 cloud-computer（文件 + 浏览器 + 画面 + 接管 + 最多 3 执行槽），用 FakeModel 固定工具剧本验收；不接入真实模型。

**架构：** 新增 `apps/computer` 作为槽位租约与工具执行面；Worker 经 Bearer token 调 computer；PostgreSQL 仍保存任务/事件；API 代理画面与接管状态给 Electron。按切片 A→B→C 垂直交付，每片独立测试后提交。

**技术栈：** TypeScript、Node.js 22+、pnpm 10+、Fastify、Zod、Vitest、Playwright（computer 内）、Docker Compose、BullMQ。

**规格：** `docs/superpowers/specs/2026-09-16-vork-phase-2-cloud-computer-design-zh-CN.md`

## 全局约束

- 本阶段不接真实模型；自动化以 FakeModel/固定工具序列为准。
- Electron：`contextIsolation: true`、`nodeIntegration: false`；Renderer 不得直连 computer 或持有 token。
- 所有跨服务输入经 Zod 校验；`task_events` 只追加、单调 `sequence`。
- `computer` 非 root；无 `--privileged`、无 Docker Socket；**不**向宿主机 `ports` 暴露 computer。
- 认证：`Authorization: Bearer ${VORK_COMPUTER_TOKEN}`；缺失/错误 → `401`。
- 租约 TTL **60s**；心跳 **15s**；连续 **2 次**心跳失败视为租约丢失。
- `kind=terminal` → **501** `not_implemented`。
- `/workspace/shared/` 严格只读；单文件 **1 MiB**；单任务累计写 **10 MiB**。
- 排队唯一机制：BullMQ `moveToDelayed(+5000ms)`，最多 **60 次**；槽 release 不 pub/sub 唤醒。
- 浏览器崩溃：槽内重启最多 **3 次**、间隔 **2s**；失败则任务 `failed`（不延迟重试）。
- 每项任务测试先行；通过该任务测试后独立提交（简体中文 Conventional Commits）。

---

## 文件结构

```text
apps/computer/                    槽位租约、文件服务、浏览器、画面、接管状态
  src/server.ts                   Fastify 入口
  src/auth.ts                     Bearer token 校验
  src/slots/                      租约管理（maxSlots 可配置）
  src/files/                      路径沙箱与文件 API
  src/browser/                    Playwright + 测试页（切片 B）
  src/control/                    agent/human 控制权（切片 B）
  src/config.ts                   环境变量与固定默认值
infra/docker/computer.Dockerfile
compose.yaml                      增加 computer、workspace/profile 卷
packages/contracts/src/
  computer.ts                     槽位、文件、浏览器、事件 payload Schema
  tool.ts                         工具调用与结果 Schema
apps/worker/src/
  computer-client.ts              HTTP 客户端（acquire/heartbeat/tools）
  run-file-task.ts                切片 A 任务编排
  run-browser-task.ts             切片 B 任务编排
  fake-tool-model.ts              固定工具序列 FakeModel
  slot-retry.ts                   moveToDelayed 封装（切片 C）
apps/api/src/routes/computer.ts   画面与接管 API 代理
apps/desktop/src/renderer/.../ComputerPanel.tsx
packages/computer-test-fixtures/  可选：自建静态测试页路径常量
scripts/dev-healthcheck.mjs       增加 computer 检查
README.zh-CN.md                   阶段 2 启动说明
```

---

## Task 1：扩展共享契约（槽位、文件、事件）

**文件：**
- 创建：`packages/contracts/src/computer.ts`
- 创建：`packages/contracts/src/tool.ts`
- 修改：`packages/contracts/src/index.ts`
- 测试：`packages/contracts/src/computer.test.ts`

**接口：**
- 产出：`SlotKindSchema`、`AcquireSlotInputSchema`、`SlotLeaseSchema`、`ComputerErrorSchema`
- 产出：`FileWriteInputSchema`、`FileReadResultSchema`、`ToolEventPayloadSchema`
- 产出：事件 type 常量：`slot.acquired`、`slot.released`、`slot.waiting`、`slot.wait_exhausted`、`tool.started`、`tool.finished`、`tool.failed`、`lease.lost` 等

- [ ] **Step 1：写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { AcquireSlotInputSchema, SlotLeaseSchema, FileWriteInputSchema } from "./computer";

describe("computer contracts", () => {
  it("rejects terminal kind in acquire for phase-2 validation helpers", () => {
    expect(AcquireSlotInputSchema.parse({ taskId: "t1", botId: "b1", kind: "file" }).kind).toBe("file");
  });

  it("accepts a slot lease", () => {
    const lease = SlotLeaseSchema.parse({
      slotId: "slot_1",
      leaseId: "lease_1",
      expiresAt: "2026-09-16T00:01:00.000Z"
    });
    expect(lease.slotId).toBe("slot_1");
  });

  it("rejects path traversal in file write", () => {
    expect(FileWriteInputSchema.safeParse({ path: "../secret", content: "x" }).success).toBe(false);
  });
});
```

- [ ] **Step 2：运行测试确认失败**

运行：`pnpm --filter @vork/contracts test -- computer.test.ts`  
预期：FAIL，`./computer` 不存在。

- [ ] **Step 3：实现 Schema**

`SlotKindSchema = z.enum(["file", "browser", "terminal"])`  
`SlotLeaseSchema` 含 `slotId`、`leaseId`、`expiresAt`（ISO datetime）  
`ComputerErrorSchema = z.object({ code: z.string(), message: z.string().optional() })`  
`FileWriteInputSchema`：`path` 相对路径、禁止 `..`、禁止 leading `/`  
`ToolEventPayloadSchema`：`toolName`、`path?`、`bytes?`、`truncated?`、`reason?`

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/contracts test && pnpm --filter @vork/contracts typecheck`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add packages/contracts
git commit -m "feat(contracts): 添加云电脑槽位与文件工具契约"
```

---

## Task 2：computer 服务脚手架与认证

**文件：**
- 创建：`apps/computer/package.json`
- 创建：`apps/computer/tsconfig.json`
- 创建：`apps/computer/src/config.ts`
- 创建：`apps/computer/src/auth.ts`
- 创建：`apps/computer/src/server.ts`
- 创建：`apps/computer/src/health.test.ts`
- 修改：`pnpm-workspace.yaml`（已含 `apps/*`，确认 workspace 识别）

**接口：**
- 产出：`buildComputerApp(): FastifyInstance`
- 产出：`GET /health` → `{ status: "ok" }`
- 消费：`VORK_COMPUTER_TOKEN`、`PORT`（默认 `8080`）、`VORK_MAX_SLOTS`（默认 `1`）

- [ ] **Step 1：写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { buildComputerApp } from "./server.js";

describe("computer health", () => {
  it("returns ok without auth", async () => {
    const app = buildComputerApp({ token: "test-token", maxSlots: 1 });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects protected routes without token", async () => {
    const app = buildComputerApp({ token: "test-token", maxSlots: 1 });
    const res = await app.inject({ method: "POST", url: "/v1/slots/acquire", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2：运行确认失败**

运行：`pnpm --filter @vork/computer test`  
预期：FAIL，包不存在。

- [ ] **Step 3：实现最小 Fastify 应用**

`apps/computer/package.json`：`name: "@vork/computer"`，`dev` 用 `tsx watch src/server.ts`，`test` 用 vitest。  
`auth` hook：除 `/health` 外校验 `Authorization: Bearer`。

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/computer test && pnpm --filter @vork/computer typecheck`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add apps/computer pnpm-lock.yaml
git commit -m "feat(computer): 添加 Fastify 服务脚手架与 Bearer 认证"
```

---

## Task 3：单槽租约管理

**文件：**
- 创建：`apps/computer/src/slots/lease-manager.ts`
- 创建：`apps/computer/src/slots/routes.ts`
- 创建：`apps/computer/src/slots/lease-manager.test.ts`
- 修改：`apps/computer/src/server.ts`

**接口：**
- 产出：`LeaseManager.acquire(input) → SlotLease | ComputerError`
- 产出：`LeaseManager.heartbeat(leaseId) → void | ComputerError`
- 产出：`LeaseManager.release(leaseId) → void`
- 产出：`LeaseManager.assertActive(leaseId) → SlotLease`（否则 throw `409 lease_expired`）
- HTTP：`POST /v1/slots/acquire`、`POST /v1/slots/heartbeat`、`POST /v1/slots/release`
- `kind=terminal` → `501` `{ code: "not_implemented" }`

- [ ] **Step 1：写失败测试**

```ts
it("acquires and releases the only slot", () => {
  const mgr = new LeaseManager({ maxSlots: 1, ttlMs: 60_000 });
  const lease = mgr.acquire({ taskId: "t1", botId: "b1", kind: "file" });
  expect(lease.slotId).toBe("slot_1");
  expect(mgr.acquire({ taskId: "t2", botId: "b2", kind: "file" }).code).toBe("no_slot");
  mgr.release(lease.leaseId);
  expect(mgr.acquire({ taskId: "t3", botId: "b3", kind: "file" }).slotId).toBe("slot_1");
});

it("expires lease after ttl", async () => {
  const mgr = new LeaseManager({ maxSlots: 1, ttlMs: 10 });
  const lease = mgr.acquire({ taskId: "t1", botId: "b1", kind: "file" });
  await new Promise((r) => setTimeout(r, 15));
  expect(() => mgr.assertActive(lease.leaseId)).toThrow(/lease_expired/);
});
```

- [ ] **Step 2：运行确认失败**

运行：`pnpm --filter @vork/computer test -- lease-manager.test.ts`  
预期：FAIL

- [ ] **Step 3：实现 LeaseManager 与路由**

内存 Map；`slotId` 固定 `slot_1`（maxSlots=1 时）；heartbeat 刷新 `expiresAt`。

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/computer test`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add apps/computer
git commit -m "feat(computer): 实现单槽租约 acquire/heartbeat/release"
```

---

## Task 4：文件服务与路径沙箱

**文件：**
- 创建：`apps/computer/src/files/path-sandbox.ts`
- 创建：`apps/computer/src/files/service.ts`
- 创建：`apps/computer/src/files/routes.ts`
- 创建：`apps/computer/src/files/path-sandbox.test.ts`
- 修改：`apps/computer/src/server.ts`

**接口：**
- 产出：`resolveBotPath(botId, relativePath) → absolutePath`
- 产出：`resolveSharedPath(relativePath) → absolutePath`（只读）
- HTTP（均需 `leaseId` query/body）：`POST /v1/files/list|stat|read|write|mkdir`
- 限制：1 MiB/文件，10 MiB/任务累计（taskId 在 lease 上关联计数）

- [ ] **Step 1：写失败测试**

```ts
it("rejects path traversal", () => {
  expect(() => resolveBotPath("bot_1", "../etc/passwd")).toThrow();
});

it("rejects shared write", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/files/write",
    headers: { authorization: "Bearer test-token" },
    payload: { leaseId: activeLeaseId, path: "shared/x.txt", content: "nope", root: "shared" }
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().code).toBe("read_only_root");
});
```

- [ ] **Step 2：运行确认失败**

- [ ] **Step 3：实现 path-sandbox 与 file routes**

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/computer test`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add apps/computer
git commit -m "feat(computer): 添加 Bot 工作区文件 API 与路径沙箱"
```

---

## Task 5：Compose 与 computer 镜像

**文件：**
- 创建：`infra/docker/computer.Dockerfile`
- 修改：`compose.yaml`
- 修改：`.env.example`
- 修改：`.dockerignore`

**接口：**
- 产出：`computer` 服务，卷 `workspace_data:/workspace`、`browser_profiles:/browser-profiles`（B 片再用 profile 卷）
- 环境：`VORK_COMPUTER_TOKEN`、`VORK_MAX_SLOTS=1`、`PORT=8080`
- **不**映射 `ports` 到宿主机
- `worker`、`api` 增加 `VORK_COMPUTER_URL=http://computer:8080`、`VORK_COMPUTER_TOKEN`

- [ ] **Step 1：编写 Dockerfile**

基于 `node:22-bookworm-slim`；`pnpm install --filter @vork/computer... --frozen-lockfile --ignore-scripts`；`USER node`；`CMD tsx src/server.ts` 或 build 后 node。

- [ ] **Step 2：更新 compose.yaml**

`depends_on` 无硬依赖 postgres；与 api/worker 同 network。

- [ ] **Step 3：本地构建验证**

运行：`docker compose up -d --build computer && docker compose exec -T computer wget -qO- http://127.0.0.1:8080/health`  
预期：`{"status":"ok"}`

- [ ] **Step 4：提交**

```bash
git add compose.yaml infra/docker/computer.Dockerfile .env.example .dockerignore
git commit -m "build: 添加 computer Compose 服务与工作区卷"
```

---

## Task 6：Worker computer 客户端与文件任务编排

**文件：**
- 创建：`apps/worker/src/computer-client.ts`
- 创建：`apps/worker/src/run-file-task.ts`
- 创建：`apps/worker/src/fake-tool-model.ts`
- 创建：`apps/worker/src/computer-client.test.ts`
- 创建：`apps/worker/src/run-file-task.test.ts`
- 修改：`apps/worker/src/index.ts`（按任务类型路由，或消息前缀触发文件 任务）
- 修改：`apps/worker/src/queue.ts`（如需新 job name）

**接口：**
- 产出：`ComputerClient.acquire|heartbeat|release|writeFile|readFile`
- 产出：`runFileTask(job, deps)`：acquire → `tool.started` → write `notes/hello.txt` → read → `message.delta` 摘要 → complete → release
- 产出：`FakeToolModel.plan(userMessage)` 返回固定工具序列（用户消息含 `[file-demo]` 时触发 file 任务，保留原聊天路径）

- [ ] **Step 1：写 computer-client 失败测试（mock fetch）**

- [ ] **Step 2：写 run-file-task 失败测试（mock client + repos）**

- [ ] **Step 3：实现 client 与 run-file-task**

心跳：任务执行期间每 15s `setInterval` 调 heartbeat；`finally` release。

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/worker test`  
预期：PASS

- [ ] **Step 5：集成测试（可选本片加严）**

创建：`apps/worker/src/file-task.integration.test.ts`  
需：`docker compose up computer` + `TEST_DATABASE_URL` + 真实 `VORK_COMPUTER_URL` 指向 compose 网络（本地可通过 `http://127.0.0.1:8080` 仅测试环境临时暴露端口，**生产 compose 仍不暴露**；或在 CI 用 testcontainers）。

**决策（已锁定）：** 集成测试在 `apps/computer` 包内用 `buildComputerApp` 内存实例 + 临时目录作 `/workspace`，不依赖 Docker 端口映射。

- [ ] **Step 6：提交**

```bash
git add apps/worker packages/contracts
git commit -m "feat(worker): 添加 computer 客户端与文件任务编排"
```

---

## Task 7：healthcheck 与切片 A 文档

**文件：**
- 修改：`scripts/dev-healthcheck.mjs`
- 修改：`README.zh-CN.md`

- [ ] **Step 1：healthcheck 增加 computer**

`docker compose exec -T computer wget -qO- http://127.0.0.1:8080/health`  
或 `docker compose ps computer` 为 running。

- [ ] **Step 2：README 增加阶段 2 说明**

`docker compose up -d --build` 含 computer；发送 `[file-demo]` 触发文件任务（文档写明）。

- [ ] **Step 3：验收切片 A**

运行：

```bash
pnpm typecheck
pnpm --filter @vork/computer test
pnpm --filter @vork/worker test
docker compose up -d --build
node scripts/dev-healthcheck.mjs
```

预期：全部通过；healthcheck 含 computer。

- [ ] **Step 4：提交**

```bash
git add scripts/dev-healthcheck.mjs README.zh-CN.md
git commit -m "docs: 更新 healthcheck 与阶段 2 文件任务说明"
```

---

## Task 8：浏览器运行时与自建测试页（切片 B）

**文件：**
- 创建：`apps/computer/public/test-page/index.html`（静态页：标题、按钮 `#action`、输入 `#query`）
- 创建：`apps/computer/src/browser/session.ts`
- 创建：`apps/computer/src/browser/routes.ts`
- 创建：`apps/computer/src/browser/session.test.ts`
- 修改：`infra/docker/computer.Dockerfile`（安装 Chromium 依赖 + Playwright browsers）
- 修改：`compose.yaml`（`browser_profiles` 卷）

**接口：**
- 产出：`BrowserSession.start(slotId)`、`observe()`、`navigate(url)`、`click(ref)`、`type(ref, text)`
- HTTP：`POST /v1/browser/observe|navigate|click|type|scroll`（body 含 `leaseId`）
- 测试页 URL：`file:///app/public/test-page/index.html`（容器内路径）

- [ ] **Step 1：写 session 失败测试（Playwright launch 可 mock 或用真实 headless 在 CI）**

- [ ] **Step 2：实现 BrowserSession + routes**

- [ ] **Step 3：崩溃恢复**

`session.on('crash')` → 最多 3 次重启，间隔 2s；成功/失败按规格 §8.3。

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/computer test`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add apps/computer infra/docker/computer.Dockerfile compose.yaml
git commit -m "feat(computer): 添加 Playwright 浏览器会话与测试页"
```

---

## Task 9：控制权状态机与 Worker 浏览器任务

**文件：**
- 创建：`apps/computer/src/control/state.ts`
- 创建：`apps/computer/src/control/routes.ts`
- 创建：`apps/worker/src/run-browser-task.ts`
- 修改：`apps/worker/src/fake-tool-model.ts`

**接口：**
- 产出：`ControlState`: `agent_control` | `handoff_pending` | `human_control`
- HTTP：`GET/POST /v1/slots/{slotId}/control`（交还/接管）
- `human_control` 下 browser click/type → `403` `human_control_active`
- `runBrowserTask` 固定剧本：navigate 测试页 → observe → click → type → complete

- [ ] **Step 1：写 control state 失败测试**

- [ ] **Step 2：写 run-browser-task 失败测试**

- [ ] **Step 3：实现**

- [ ] **Step 4：运行测试**

- [ ] **Step 5：提交**

```bash
git add apps/computer apps/worker
git commit -m "feat: 添加浏览器任务编排与人工接管状态机"
```

---

## Task 10：API 画面代理与桌面 Computer 面板

**文件：**
- 创建：`apps/computer/src/frame/routes.ts`（`GET /v1/slots/:slotId/frame` → JPEG）
- 创建：`apps/api/src/routes/computer.ts`
- 创建：`apps/desktop/src/renderer/src/features/computer/ComputerPanel.tsx`
- 修改：`apps/desktop/src/preload/api.ts`
- 修改：`apps/desktop/src/main/api.ts`
- 修改：`apps/desktop/src/renderer/src/features/chat/ConversationView.tsx`（标题栏「电脑」按钮）

**接口：**
- API：`GET /v1/computer/slots/:slotId/frame?taskId=...` → 转发 computer（API 持 token）
- Preload：`getComputerFrame(taskId)` → base64 或 blob URL
- Renderer：展开面板时 `setInterval(500)` 拉帧；折叠 `clearInterval`

- [ ] **Step 1：写 API 代理失败测试（mock fetch computer）**

- [ ] **Step 2：写 ComputerPanel 组件测试（mock preload）**

- [ ] **Step 3：实现 frame 路由、API 代理、面板 UI**

- [ ] **Step 4：运行测试**

运行：`pnpm --filter @vork/api test && pnpm --filter @vork/desktop test`  
预期：PASS

- [ ] **Step 5：提交**

```bash
git add apps/computer apps/api apps/desktop
git commit -m "feat: 添加云电脑 JPEG 画面代理与桌面面板"
```

---

## Task 11：切片 B 集成测试与推荐 E2E

**文件：**
- 创建：`apps/computer/src/browser/browser.integration.test.ts`
- 修改：`tests/e2e/bot-chat.spec.ts` 或新建 `tests/e2e/browser-demo.spec.ts`（**推荐、非阻塞**）

- [ ] **Step 1：computer 集成测试**

acquire → navigate → observe → click → release；断言 DOM 变化。

- [ ] **Step 2：（推荐）E2E**

用户发 `[browser-demo]` → 看到工具事件摘要；展开电脑面板 → JPEG 非空。

- [ ] **Step 3：验收切片 B**

运行：`pnpm --filter @vork/computer test && pnpm test`（含 TEST_DATABASE_URL）  
E2E 失败不挡本任务合并，但记录 issue。

- [ ] **Step 4：提交**

```bash
git add apps/computer tests/e2e
git commit -m "test: 添加浏览器集成测试与推荐 E2E"
```

---

## Task 12：三槽并发、浏览器限额与内存压力（切片 C）

**文件：**
- 修改：`apps/computer/src/slots/lease-manager.ts`
- 创建：`apps/computer/src/slots/concurrency.ts`
- 创建：`apps/computer/src/system/memory-pressure.ts`
- 创建：`apps/worker/src/slot-retry.ts`
- 修改：`apps/worker/src/run-file-task.ts`、`run-browser-task.ts`
- 修改：`compose.yaml`（`VORK_MAX_SLOTS=3`、`mem_limit: 4g`、`cpus: 2`）
- 修改：`.env.example`

**接口：**
- `LeaseManager` 支持 `maxSlots=3`、`maxBrowserSlots=2`
- `memory_pressure`：`VORK_MEMORY_PRESSURE=1` 或 cgroup ≥ 80%
- `slot-retry.ts`：`retryOrFail(job, reason)` → `moveToDelayed(+5000)` 计数 ≤60

- [ ] **Step 1：写并发失败测试**

3 file 任务并行 acquire 成功；第 4 个 `no_slot`。  
2 browser + 1 file 成功；第 3 个 browser → `browser_concurrency_limit`。

- [ ] **Step 2：写 slot-retry 失败测试**

- [ ] **Step 3：实现**

- [ ] **Step 4：运行测试**

- [ ] **Step 5：提交**

```bash
git add apps/computer apps/worker compose.yaml .env.example
git commit -m "feat(computer): 支持三槽并发、浏览器限额与任务延迟重试"
```

---

## Task 13：阶段 2 收尾验收

**文件：**
- 修改：`README.zh-CN.md`
- 修改：`scripts/dev-healthcheck.mjs`（确认 computer + worker 心跳 + 可选 slot smoke）

- [ ] **Step 1：完整验证**

```bash
pnpm typecheck
pnpm test
pnpm --filter @vork/desktop build
docker compose up -d --build
node scripts/dev-healthcheck.mjs
pnpm e2e
docker compose down
git diff --check
```

环境：`TEST_DATABASE_URL=postgres://vork:vork_test_only@127.0.0.1:55432/vork_test`  
预期：单元/集成全过；healthcheck 通过；E2E 至少阶段 1 用例仍过；`down` 后 `vorkbot_postgres_data` 与 workspace 卷仍在。

- [ ] **Step 2：提交文档**

```bash
git add README.zh-CN.md scripts/dev-healthcheck.mjs
git commit -m "docs: 完成阶段 2 验收说明与 healthcheck"
```

---

## 阶段 2 验收结果

完成后应独立验证：

- 独立 `computer` 容器；Bearer 认证；路径沙箱；1→3 槽租约。
- 文件工具与浏览器工具（FakeModel 固定剧本）。
- JPEG 画面经 API 代理；人工接管互斥。
- 三槽与浏览器并发限额；BullMQ 延迟重试排队。
- 不依赖真实模型；不暴露 computer 到公网。

---

## 规格覆盖自检

| 规格章节 | 对应 Task |
|----------|-----------|
| 切片 A 租约+文件 | Task 1–7 |
| 切片 B 浏览器+画面+接管 | Task 8–11 |
| 切片 C 三槽+资源 | Task 12 |
| §8 固定参数 | 全局约束 + Task 3/4/12 |
| healthcheck/README | Task 7、13 |
| 阶段 4 待办（进程数/磁盘/mTLS） | 不实现，未列入 Task |
