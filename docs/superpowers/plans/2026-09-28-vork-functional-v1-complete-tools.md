# Vork 功能版 V1：完整工具执行实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 通过统一结构化动作自主调用浏览器、终端和完整文件工具，并在 Computer 的 Bot 工作区沙箱内安全执行。

**Architecture:** `packages/contracts` 定义唯一动作与 Computer 请求/响应契约；`apps/computer` 维护每个 terminal lease 的独立子进程及有界输出缓冲；`apps/worker` 通过统一 `executeToolAction` 分派所有工具。槽位 lease 仍是生命周期边界，释放或过期时同时清理浏览器与终端资源。

**Tech Stack:** TypeScript 5.9、Zod 3、Fastify 5、Node.js `child_process`、Vitest、Playwright、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-09-28-vork-functional-v1-design-zh-CN.md`

## Global Constraints

- 模型每轮只能返回一个通过 Zod 校验的动作。
- 终端工作目录固定为 `/workspace/bots/{bot_id}`，进程使用 Computer 容器的非 root 用户。
- 终端输出、运行时间和空闲时间必须有界；release、lease 过期和 terminate 必须清理完整进程组。
- `sudo`、Docker、绝对路径、路径穿越和宿主机访问始终拒绝。
- PostgreSQL 继续作为任务与事件事实来源；Renderer 不接触 Computer token。
- 本轮不实现暂停恢复、Routines、Skill 发布或生产部署。
- 不执行 Git 提交；用户统一检查后自行提交。

---

### Task 1: 扩展统一动作与 Computer 契约

**Files:**
- Modify: `packages/contracts/src/agent.ts`
- Modify: `packages/contracts/src/computer.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/agent.test.ts`
- Test: `packages/contracts/src/computer.test.ts`

**Interfaces:**
- Produces: `AgentToolAction`，覆盖 `browser.navigate|observe|click|type|scroll`、`terminal.start|write|read|terminate`、`file.list|stat|read|write|mkdir|move|delete`
- Produces: `TerminalStartResult`、`TerminalReadResult`、`TerminalStatus` 及对应 Zod Schema

- [x] **Step 1:** 先写契约测试，断言合法动作可解析、未知字段/空 sessionId/越界读取参数被拒绝。
- [x] **Step 2:** 运行 `pnpm --filter @vork/contracts test`，确认因 Schema 尚未支持而失败。
- [x] **Step 3:** 用严格 Zod object 和 discriminated union 实现最小契约；终端读取使用单调 `cursor`，输出结果包含 `nextCursor`、`truncated`、`status`、`exitCode`。
- [x] **Step 4:** 再运行 contracts 测试与 typecheck，确认通过。

### Task 2: Computer 终端会话生命周期

**Files:**
- Create: `apps/computer/src/terminal/session.ts`
- Create: `apps/computer/src/terminal/session.test.ts`
- Create: `apps/computer/src/terminal/service.ts`
- Create: `apps/computer/src/terminal/service.test.ts`
- Create: `apps/computer/src/terminal/routes.ts`
- Create: `apps/computer/src/terminal/routes.test.ts`
- Modify: `apps/computer/src/server.ts`
- Modify: `apps/computer/src/slots/routes.ts`
- Modify: `apps/computer/src/slots/lease-manager.ts`

**Interfaces:**
- Produces: `TerminalService.start({leaseId, command?, cols?, rows?})`、`write({leaseId, sessionId, input})`、`read({leaseId, sessionId, cursor?})`、`terminate({leaseId, sessionId})`、`releaseSlot(slotId)`
- Consumes: active terminal lease and Bot workspace path from `LeaseManager.assertActive`

- [x] **Step 1:** 写失败测试：terminal lease 可获取；命令只在 Bot 目录运行；读取按 cursor 增量返回；输出超过 1 MiB 截断；terminate/release/expiry 终止进程组；非 terminal lease 被拒绝。
- [x] **Step 2:** 运行 Computer 聚焦测试并确认预期失败。
- [x] **Step 3:** 用 `spawn` 创建无 shell插值的 `/bin/sh` 会话，设置独立进程组、5 分钟最大时长、60 秒空闲时长和 1 MiB 环形输出缓冲；所有路径由 botId 推导。
- [x] **Step 4:** 注册 `/v1/terminal/start|write|read|terminate`，并让槽位 release/expiry 调用 `releaseSlot`。
- [x] **Step 5:** 运行 Computer 测试、typecheck，并在容器镜像就绪后执行真实 start→write→read→terminate 集成验证。

### Task 3: 补齐 Computer 文件操作

**Files:**
- Modify: `apps/computer/src/files/service.ts`
- Modify: `apps/computer/src/files/routes.ts`
- Modify: `apps/computer/src/files/routes.test.ts`
- Test: `apps/computer/src/files/service.test.ts`

**Interfaces:**
- Produces: `move({leaseId, from, to})`、`delete({leaseId, path, recursive?})`
- Maintains: existing sandbox, shared root read-only and per-task write quota

- [x] **Step 1:** 写失败测试：工作区内移动成功；覆盖目标与跨根移动拒绝；普通文件删除成功；非空目录只有显式 `recursive` 才允许；路径穿越拒绝。
- [x] **Step 2:** 运行聚焦测试确认失败。
- [x] **Step 3:** 用 `rename`、`unlink`、`rm` 的最小封装实现，并为确定性错误返回稳定 code。
- [x] **Step 4:** 运行 Computer 文件测试与 typecheck。

### Task 4: Worker 统一 Computer 客户端与策略

**Files:**
- Modify: `apps/worker/src/computer-client.ts`
- Modify: `apps/worker/src/policy.ts`
- Modify: `apps/worker/src/policy.test.ts`
- Modify: `apps/worker/src/action-model.ts`
- Modify: `apps/worker/src/action-model.test.ts`

**Interfaces:**
- Produces: `ComputerClientLike` 中与动作一一对应的方法
- Produces: 统一策略结果 `allow | needs_approval | deny`

- [x] **Step 1:** 写失败测试：浏览器观察/导航、终端安全命令允许；下载/安装/执行新脚本需要审批；sudo/docker/路径逃逸拒绝；覆盖和删除需要审批。
- [x] **Step 2:** 运行 Worker 聚焦测试确认失败。
- [x] **Step 3:** 扩展客户端方法与 ActionModel system prompt，所有响应再次用共享 Schema 校验。
- [x] **Step 4:** 实现基于动作字段的最小策略分类，不通过字符串拼接执行命令。
- [x] **Step 5:** 运行策略、ActionModel、客户端测试和 typecheck。

### Task 5: Agent 循环统一工具分派

**Files:**
- Create: `apps/worker/src/tool-executor.ts`
- Create: `apps/worker/src/tool-executor.test.ts`
- Modify: `apps/worker/src/agent-loop.ts`
- Modify: `apps/worker/src/agent-loop.test.ts`
- Modify: `apps/worker/src/fake-action-model.ts`

**Interfaces:**
- Produces: `executeToolAction(action, context): Promise<string>`，统一保存 `tool.started|finished|failed`
- Consumes: Task budget、policy、Computer lease 与 `AgentToolAction`

- [x] **Step 1:** 写失败测试：每种工具动作分派到正确客户端方法；观察结果有长度上限；终端 cursor 在连续读取间保留；工具调用计入统一预算。
- [x] **Step 2:** 运行 Worker 聚焦测试确认失败。
- [x] **Step 3:** 抽取工具执行器并扩展 `isToolAction`；Agent 根据首个动作需要申请 `file|browser|terminal` 槽位，后续跨工具动作复用同一通用槽位。
- [x] **Step 4:** 增加确定性 FakeActionModel 开发任务序列：终端写文件、运行测试、读取输出、完成任务。
- [x] **Step 5:** 运行 Worker 测试、完整非 E2E 测试与 typecheck。

### Task 6: 容器集成与状态文档

**Files:**
- Modify: `README.zh-CN.md`
- Create: `docs/handovers/2026-09-28-vork-functional-v1-complete-tools-status-zh-CN.md`

**Interfaces:**
- Produces: 可复验的启动、终端演示和已知限制说明

- [x] **Step 1:** 重建确有源码变化的 Computer/Worker 镜像并保留数据卷。
- [x] **Step 2:** 运行 healthcheck、浏览器 E2E、终端容器集成、全量 typecheck/test 和 Electron build。
- [x] **Step 3:** 记录实际结果，不把未运行或被环境阻塞的项目写成通过。
- [x] **Step 4:** 运行 `git diff --check` 并列出所有未提交修改。

## 完成标准

- 统一动作 Schema 拒绝所有未知或越界输入。
- Terminal lease 可以安全启动、增量读取、写入和终止，release/expiry 无残留进程。
- Agent 可自主组合浏览器、终端和文件动作，所有动作经过预算、策略、事件与 Computer 边界。
- Browser、Computer、Worker、contracts 的聚焦测试及全量 typecheck 通过。
- 不提交 Git，由用户在阶段检查后统一提交。
