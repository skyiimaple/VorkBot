# Vork 功能版 V1：完整工具执行状态

交接日期：2026-09-29。仓库：`/Users/maple/code/repo/vork-bot`。分支：`main`。本轮未提交 Git。

## 已实现

- 统一 `AgentAction` 已覆盖浏览器、终端和完整文件动作。
- 新增内部 `agent` 槽位，使同一任务可以组合三类工具，同时仍受三槽租约限制。
- Computer 终端支持 start、write、增量 read、terminate；工作目录固定为 `/workspace/bots/{bot_id}`。
- Linux 容器通过系统 `script` 创建真实伪终端；进程以非 root Computer 用户运行。
- 终端限制为 1 MiB 保留输出、单次最多读取 64 KiB、默认 5 分钟总时长和 60 秒空闲时长。
- release、lease 过期、服务关闭和显式 terminate 都会终止对应进程组。
- 文件工具新增 move/delete，禁止静默覆盖，非空目录删除必须显式 recursive。
- Worker Computer 客户端、模型动作提示、权限策略和 Agent 循环已统一接入全部工具。
- 新增 `[agent-terminal]` 确定性本地验收入口；`[agent-llm]` 的真实模型可自主返回相同动作。
- Desktop 在收到 `message.completed` 后会重新读取持久化消息，工具任务即使没有流式 delta 也能立即显示最终回复。
- Computer 镜像改用与锁定依赖一致的 Playwright `v1.63.0-noble` 官方基础镜像，避免重复安装 Chromium 系统依赖；服务仍以非 root `pwuser` 运行。

## 权限边界

- 安全构建、测试和工作区内读取允许自动执行。
- 文件移动/删除、网络下载、包安装、克隆仓库和执行新脚本需要审批。
- `sudo`、Docker/Podman、Docker Socket、系统敏感目录和路径逃逸直接拒绝。
- shared 文件根继续只读；Renderer 不持有 Computer 地址或 token。

## 已完成验证

| 项目 | 结果 |
|---|---|
| contracts | 30/30 通过 |
| Computer | 38 个测试通过，1 个需要浏览器环境的测试跳过；新增终端测试在 macOS 上另跳过 Linux PTY 专项 |
| Worker | 67/67 通过 |
| 全仓非 E2E | 通过 |
| 全量 typecheck | 通过 |
| Electron build | 通过 |
| 容器健康检查 | API、PostgreSQL、Valkey、Worker、Computer 全部就绪 |
| Linux PTY 专项 | Computer 容器内 7/7 通过 |
| Electron E2E | 2/2 通过，含浏览器演示 |
| `[agent-terminal]` | API → Worker → Computer → PTY → assistant 回复完整链路通过 |
| 镜像 | Computer、Worker、API、migrate 已按当前源码重建；迁移已执行 |

首次切换到非 root `pwuser` 时，已有的 `workspace_data` 与 `browser_profiles` 数据卷需要一次所有权迁移；全新数据卷会由镜像中的目录权限自动初始化。Playwright 官方镜像面向开发和测试；生产部署时仍需补充 Chromium 沙箱与更严格的容器隔离。

## 主要文件

- `packages/contracts/src/agent.ts`
- `packages/contracts/src/computer.ts`
- `apps/computer/src/terminal/session.ts`
- `apps/computer/src/terminal/service.ts`
- `apps/computer/src/terminal/routes.ts`
- `apps/computer/src/files/service.ts`
- `apps/worker/src/computer-client.ts`
- `apps/worker/src/tool-executor.ts`
- `apps/worker/src/agent-loop.ts`
- `apps/worker/src/policy.ts`

下一切片是任务安全与恢复：暂停/恢复、检查点、重试、不确定副作用处理和 Electron 审批/执行面板。
