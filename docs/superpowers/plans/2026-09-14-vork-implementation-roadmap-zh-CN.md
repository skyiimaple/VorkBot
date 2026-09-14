# Vork 实施路线图

**设计规格：** `docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md`

Vork 包含多个能够独立验收的子系统。实施拆为四个阶段，每个阶段单独编写详细计划、测试并评审，避免桌面端、云电脑和 Agent Runtime 在同一批改动中互相掩盖问题。

## 阶段 1：基础设施与对话式创建 Bot

交付一个可安装运行的 Electron 开发版：用户可通过 `+ -> 新聊天 -> 创建新 Bot` 创建 Bot、发送消息并收到由确定性假模型生成的流式响应。包含 monorepo、共享契约、PostgreSQL、Redis/BullMQ、API、Worker、事件游标和 Electron 安全边界。

详细计划：`docs/superpowers/plans/2026-09-14-vork-phase-1-foundation-zh-CN.md`

## 阶段 2：共享云电脑与三执行槽

交付持久化 cloud-computer 容器、三个执行槽、Chromium/Playwright、PTY、文件服务、实时画面、人工接管、资源限制、租约和崩溃恢复。验收研究 Bot、开发 Bot 和文件 Bot 的受控工具执行。

## 阶段 3：真实 Agent、记忆与 Skills

接入可配置模型供应商，完成受控 Agent 循环、上下文组装、预算、权限审批、身份/事实/工作记忆，以及“保存为 Skill”和自动 Skill 草稿建议。保留但不开放多 Bot 委派与 routines。

## 阶段 4：安全加固、部署与发布

完成腾讯云 Docker Compose、Caddy、备份恢复、监控、Secret 管理、macOS Keychain、应用签名/公证、自动更新、断线恢复及全量端到端验收。

## 阶段边界

- 每个阶段必须在干净环境中通过自己的测试和验收场景。
- 后续阶段只依赖前一阶段已发布的类型化接口，不读取相邻模块内部实现。
- 每个阶段开始前都要从已批准规格生成独立的详细实施计划。
- 任何新需求先回写设计规格，再进入对应阶段计划。

