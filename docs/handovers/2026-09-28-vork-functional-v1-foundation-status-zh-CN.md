# Vork 功能版 V1：稳定基线状态

交接日期：2026-09-28。仓库：`/Users/maple/code/repo/vork-bot`。分支：`main`。本轮按用户要求未提交 Git，未更新依赖，未重建或拉取 Docker 镜像。

## 本轮结果

- 修复 Electron 对空消息列表的类型收窄问题。
- 修复 Worker Agent 动作的 TypeScript 类型守卫。
- 根工作区测试改为包级串行执行，避免多个集成测试同时清理同一测试数据库而互相干扰。
- Electron 云电脑预览按窗口宽度只挂载一个实例，避免宽屏与窄屏组件同时轮询。
- Electron 聊天 E2E 不再依赖 FakeModel 固定文案；现在验证真实非空流式回复，并确认重启后同一会话原样恢复。

## 验证矩阵

| 项目 | 命令 | 结果 |
|---|---|---|
| Compose 健康检查 | `pnpm healthcheck` | 通过：API、PostgreSQL、Valkey、Worker、Computer ready |
| 非 E2E 全量测试 | `TEST_DATABASE_URL='postgres://vork:vork_test_only@127.0.0.1:55432/vork_test' pnpm test` | 通过；根脚本采用 workspace 串行执行 |
| 全量类型检查 | `pnpm typecheck` | 通过 |
| API/SSE 冒烟 | `pnpm smoke -- --sse --timeout=60000` | 通过；实际调用已配置的 DeepSeek，收到非空回复 |
| Electron 构建 | `pnpm --filter @vork/desktop build` | 通过 |
| Desktop 单元测试 | `pnpm --filter @vork/desktop test -- --run` | 13 个文件、51 个测试全部通过 |
| 聊天持久化 E2E | `pnpm --filter @vork/e2e exec playwright test bot-chat.spec.ts` | 通过 |
| 浏览器演示 E2E | `pnpm e2e` 中 `browser-demo.spec.ts` | 环境阻塞，原因见下文 |

验证使用独立测试服务：PostgreSQL `vork-test-postgres`（`127.0.0.1:55432`）和 Valkey `vork-test-valkey`（`127.0.0.1:56379`），均由本机已有镜像以 `--pull=never` 创建。开发 Compose 数据卷未被清理。

## 当前唯一 E2E 阻塞

正在运行的 `vorkbot-computer:latest` 镜像创建于 2026-09-16，镜像 ID 为 `45a2bdef55d7`。当前 Worker 发送 `POST /v1/browser/navigate` 时，旧 Computer 容器直接返回 `404 Route POST:/v1/browser/navigate not found`，任务因此以 `COMPUTER_UNAVAILABLE` 失败。

这是运行镜像与当前源码不一致，不是 Compose 健康状态问题：旧镜像仍有 `/health` 和槽位接口，所以健康检查会通过。用户明确要求本轮不重建镜像，因此没有执行修复性构建。要验收 `[browser-demo]`，后续需在用户允许时更新 Computer 运行镜像，再重新运行 `pnpm e2e`。

## 工作区未提交改动

- `apps/desktop/src/renderer/src/features/chat/ConversationView.tsx`
- `apps/worker/src/agent-loop.ts`
- `package.json`
- `tests/e2e/bot-chat.spec.ts`
- `README.zh-CN.md`
- `docs/superpowers/plans/2026-09-28-vork-functional-v1-foundation-stabilization.md`
- `docs/handovers/2026-09-28-vork-functional-v1-foundation-status-zh-CN.md`

## 后续建议顺序

1. 用户允许后仅更新 Computer 运行镜像，复验完整 `pnpm e2e`。
2. 开始功能版 V1 第二切片：终端工具与统一自主工具协议。
3. 再依次完成任务恢复与安全、记忆与 Skills 闭环、Routines 与最终 E2E。

终端、开放式浏览器自主操作、增强记忆、自动经验总结、完整 Skills 生命周期和定时任务尚未达到功能版 V1 完成标准；当前状态是稳定基线完成，浏览器演示受旧镜像阻塞。
