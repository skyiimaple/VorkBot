# Vork 功能版 V1 设计

**日期：** 2026-09-28  
**状态：** 待用户审阅  
**基础版本：** `main` @ `ef56573`  
**上位规格：** `2026-09-14-vork-system-design-zh-CN.md`

## 1. 目标

本规格将 Vork 的近期目标收敛为“单用户、可在本地完整使用的功能版 V1”。V1 必须让用户创建持久 Bot，通过自然语言让 Bot 自主选择浏览器、终端和文件工具，并具备任务控制、权限审批、记忆、Skills 与定时任务闭环。

生产部署暂不作为 V1 完成门槛。腾讯云、Caddy/HTTPS、备份恢复、macOS 签名公证、自动更新和公开多用户能力后置。

## 2. 当前基础与原则

现有系统已经提供 Electron 客户端、Fastify API、PostgreSQL、Valkey/BullMQ、Worker、共享 Computer 服务、三个执行槽、浏览器/文件工具、任务事件流、基础审批、记忆与 Skill 草稿。V1 在这些边界上补齐闭环，不新建第二套任务或调度系统。

核心原则：

- PostgreSQL 是业务事实来源；Valkey 只承载队列、唤醒和临时租约。
- 模型只能返回经 Zod 校验的单一结构化动作，不能直接操作宿主机或 Docker。
- 浏览器、终端和文件均由 Computer 服务执行；Renderer 不持有 Computer token。
- 所有自动、手动和定时触发最终都创建同一种 Task，并经过相同的预算、权限、审批与事件链路。
- 长期记忆和生成的 Skill 均必须可追溯；敏感记忆和高风险操作必须确认。
- `[file-demo]`、`[browser-demo]` 等固定剧本只保留为测试兼容入口，不再作为用户主路径。

## 3. V1 范围

### 3.1 稳定基线

- 根目录类型检查、非环境依赖测试和 Electron 构建全部通过。
- Compose 中 PostgreSQL、Valkey、API、Worker、Computer 与迁移服务可重复启动并通过健康检查。
- 使用独立测试数据库运行数据库/API/Worker 集成测试。
- 当前聊天、创建 Bot、取消任务、凭据和 Computer 演示能力不得回归。

### 3.2 自主工具 Agent

模型每轮返回一个动作，V1 支持：

- `message.reply`
- `browser.navigate|observe|click|type|scroll`
- `terminal.start|write|read|terminate`
- `file.list|stat|read|write|mkdir|move|delete`
- `memory.propose`
- `skill.invoke`
- `approval.request`
- `task.complete|fail`

Worker 负责循环编排：组装受限上下文、调用模型、校验动作、检查预算与取消信号、调用权限层、执行工具、保存观察结果，然后进入下一轮。任何非法或未知动作均不得到达 Computer。

Agent 上下文只包含 Bot 身份、任务目标、近期对话、摘要、相关记忆、启用的 Skill、当前工具状态和数量受限的近期观察，不在每轮发送完整历史。

### 3.3 终端工具

每个活动执行槽拥有独立 PTY 会话，工作目录固定在 `/workspace/bots/{bot_id}`。Computer 以非 root 用户运行，终端不得访问 Docker Socket、宿主机挂载或其他 Bot 工作区。

终端接口提供启动、写入、增量读取、终止和进程状态。每条命令限制运行时间、输出字节、进程数和空闲时间；任务结束、取消、租约丢失或超时后必须终止完整进程树。

权限规则：

- 只读命令及工作区内安全构建/测试命令可按策略自动执行。
- 安装软件、网络下载、执行新脚本和写入大量文件需要按 Bot 策略决定是否审批。
- 删除、覆盖重要文件、发送/上传数据、访问敏感路径、提权及宿主机操作必须审批或直接拒绝。
- `sudo`、Docker 命令、访问系统 Secret、突破工作区和关闭审计始终拒绝。

### 3.4 任务控制、审批与恢复

任务状态统一为：

```text
queued -> running -> waiting_approval | paused | completed | failed | cancelled
waiting_approval -> queued | failed | cancelled
paused -> queued | cancelled
```

- 用户可以暂停、恢复和取消任务。
- 暂停在当前原子工具动作结束后生效；取消应中断模型请求和可安全中断的工具进程。
- 审批卡片同时显示动作摘要、风险原因、影响对象和“批准/拒绝”。批准后重新入队并从持久检查点继续，不能重复已确认成功的副作用。
- 槽位繁忙、临时网络错误和模型限流采用有上限的延迟重试；策略拒绝、预算超限和确定性业务错误不自动重试。
- API、Worker 或 Computer 重启后，通过 Task、事件、检查点和过期租约恢复；无法安全判断副作用结果时进入 `uncertain`，等待核实或用户处理。

预算至少限制模型轮数、工具调用次数、总运行时间、单命令时间、输出大小、连续失败和重复动作。预算超限生成明确事件并终止任务。

### 3.5 记忆闭环

记忆分为身份、事实和工作记忆。每条长期记忆记录 Bot、内容、来源消息/任务、敏感级别、置信度、创建时间、最近使用时间和替代关系。

任务开始时，记忆服务根据 Bot、当前目标和最近对话检索数量受限的相关记忆，并以带来源的独立上下文段注入 Agent。任务事件记录使用了哪些记忆 ID，但不重复写入敏感正文。

模型只能提出记忆建议。普通记忆经去重与冲突检查后保存；敏感记忆等待审批。用户可查看、编辑、替代和删除记忆。工作记忆在任务完成时压缩，在失败或取消时保存可恢复摘要或清除临时内容。

### 3.6 Skills 闭环

Skill 状态为 `draft -> published -> archived`。成功任务可以生成草稿，但不能自动启用。

每个 Skill 包含名称、版本、适用任务、输入输出 Schema、语义步骤、需要的工具/域名、权限、预算、恢复方法、来源任务和完整性哈希。用户可以查看差异、审核并发布版本，再按 Bot 启用或停用。

Agent 只能看到当前 Bot 已启用的已发布 Skill。`skill.invoke` 先校验输入和权限，然后将 Skill 作为受限步骤提示加入当前 Agent 循环；Skill 不可绕过任务预算和审批策略。执行结果、版本与成功/失败状态进入任务事件和审计信息。

### 3.7 定时任务（Routines）

Routine 定义为：

```text
触发器 + Bot + 任务模板 + 时区 + 预算 + 权限策略 + 启用状态
```

V1 支持一次性时间和标准重复规则；内部统一存储为可验证的调度表达，界面提供日常语言选项，不要求用户手写 Cron。每条 Routine 记录 `next_run_at`、`last_run_at` 和最近结果。

调度器只负责在到期时以幂等键创建普通 Task 并计算下一次时间。定时 Task 与手动 Task 使用相同队列、槽位、Agent、审批和事件系统。

行为规则：

- 支持创建、编辑、启用、暂停、立即运行和删除。
- 同一 Routine 的重复触发使用唯一运行键去重。
- 上次仍在运行时，默认跳过并记录原因；用户可选择排队，但 V1 不允许同一 Routine 并行执行。
- 服务离线期间错过的执行默认只补最近一次，避免启动风暴。
- 进入审批后保留等待状态，不因下一次调度而重复创建同一运行。
- 执行历史展示计划时间、实际开始/结束、Task 链接和结果。

### 3.8 Electron 体验

- 保持当前简洁 Grok 风格：侧栏、新聊天、对话和底部用户入口。
- 实时电脑画面仍默认隐藏。
- 对话标题栏提供任务状态、电脑入口和暂停/恢复/取消操作。
- 审批请求以内嵌卡片展示；管理区提供任务、记忆、Skills、文件、凭据、Routines 和设置。
- 终端输出、工具事件和文件变更位于按需展开的执行面板，不持续占用聊天主界面。
- 所有失败状态给出用户可执行的下一步，如重试、修改权限、登录、接管或取消。

## 4. 组件与数据流

```text
手动消息 / Routine 到期
        -> API 创建 Task 与队列 Job
        -> Worker 获取 Task 并申请执行槽
        -> 上下文组装（Bot + 对话摘要 + 相关记忆 + 已启用 Skills）
        -> ActionModel 返回单一结构化动作
        -> Budget + Policy
             -> allow: Computer/内部服务执行
             -> needs_approval: 持久化并等待用户
             -> deny: 记录并让 Agent 修正或失败
        -> 持久化 observation/checkpoint/event
        -> 继续循环或进入终态
```

建议模块边界：

- `packages/contracts`：动作、任务状态、审批、记忆、Skill、Routine 与工具 Schema。
- `packages/database`：新增/补齐 checkpoints、tool_calls、memories、skills、skill_versions、bot_skills、routines、routine_runs 与审计字段。
- `apps/computer`：PTY、文件变更与既有浏览器执行面。
- `apps/worker`：上下文组装、Agent 循环、预算、策略、检查点、Skill 调用和 Routine scheduler/producer。
- `apps/api`：管理 API、审批、任务控制和实时事件。
- `apps/desktop`：对话内控制与管理页面；所有数据经 Preload 白名单访问。

## 5. API 与安全边界

API 至少提供：

- `POST /v1/tasks/:id/pause|resume|cancel`
- `POST /v1/tasks/:id/approvals`
- `GET /v1/bots/:id/memories` 及记忆编辑/删除
- `POST /v1/skills`、发布版本、归档、按 Bot 启停
- `GET|POST|PUT|DELETE /v1/routines`、立即运行与执行历史
- 既有凭据 API 保持只写密钥、只返回掩码

所有输入使用共享 Zod Schema。用户身份来自服务端单用户上下文，不接受 Renderer 任意传入 `userId`。Secret、Cookie、完整终端敏感输出不得进入普通事件或日志。Computer 继续只对 Compose 内网开放。

## 6. 错误处理与可观察性

用户可见错误使用稳定错误码并附建议动作。任务事件保持只追加和单调序号。关键事件包括模型动作、策略决定、审批、槽位、工具生命周期、记忆引用、Skill 版本、Routine 触发、预算和检查点恢复。

日志通过 request/task/tool/routine ID 关联并自动脱敏。V1 本地版至少暴露健康状态、队列长度、活动槽位、等待审批数和最近调度结果，不要求生产监控平台。

## 7. 测试与验收

每个切片测试先行，并至少包含：

- 单元测试：动作 Schema、预算、策略、PTY 生命周期、记忆检索、Skill 状态机、调度计算与幂等。
- 契约测试：Electron IPC、HTTP、SSE、Computer 工具接口。
- 集成测试：独立 PostgreSQL、Valkey、受控 Computer 和自建测试网站。
- E2E：Electron 创建 Bot、发送自然语言任务、工具执行、审批、任务控制和持久恢复。

功能版 V1 必须在干净本地环境通过以下场景：

1. 对话式创建 Bot，关闭并重启 Electron 后身份、对话和消息仍存在。
2. 研究 Bot 自主使用受控浏览器访问多个本地测试页，生成带来源的 Markdown 结果。
3. 开发 Bot 使用终端修改示例项目并运行测试，用户可查看输出和文件变更。
4. 文件 Bot 整理文件，并在覆盖或删除前请求审批；批准后只执行一次。
5. Bot 在后续任务中检索并正确使用已批准记忆，删除记忆后不再注入。
6. 从成功任务生成 Skill 草稿，发布并为 Bot 启用后可调用指定版本。
7. Routine 到期创建任务，重启调度器不重复创建；暂停后不再触发，立即运行留下历史。
8. 运行中任务可暂停、恢复和取消；客户端关闭不终止后台任务，重连可补齐事件。
9. 完整 `typecheck`、单元/集成测试、Electron build、Compose healthcheck 与核心 E2E 全部通过。

## 8. 实施切片

1. **稳定基线：** 修复现有类型错误，恢复 Compose/API，完成当前回归与干净提交。
2. **完整工具执行：** PTY + 统一工具动作 + 真/假 ActionModel 自主调用。
3. **任务安全与恢复：** 暂停/恢复、审批 UI、预算、重试、检查点和不确定副作用处理。
4. **持久智能：** 记忆检索注入与 Skills 审核、版本、启用和调用。
5. **自动运行与验收：** Routines、执行历史和全量 E2E。

每个切片完成后独立验证和提交，再征得用户同意进入下一切片；不进行无必要的重复复核。

## 9. V1 明确不做

- 腾讯云或其他公网生产部署、Caddy/HTTPS、生产备份和监控。
- macOS 签名、公证、自动更新和正式安装包发布。
- 多用户、团队、计费、公共市场和移动端。
- 多 Bot 群聊、Bot 间任务委派和 Bot 内多层临时 Agent。
- 完整桌面环境、宿主机控制、无限 Shell 或自动启用生成的 Skill。
- Jev 决策模型接入；其作为后续可选策略提供者，不阻塞 V1。

## 10. 完成定义

只有第 7 节九项验收全部通过，且工作区干净、已知限制写入中文文档，才可以称为“Vork 功能版 V1 完成”。生产部署准备度另行评估，不影响这一功能版本的命名。
