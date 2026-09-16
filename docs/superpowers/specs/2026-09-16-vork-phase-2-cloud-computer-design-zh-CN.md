# Vork 阶段 2 设计：共享云电脑与执行槽

**日期：** 2026-09-16  
**状态：** 歧义已收敛，待用户审阅  
**仓库：** `/Users/maple/code/repo/VorkBot`  
**依据：** `docs/superpowers/specs/2026-09-14-vork-system-design-zh-CN.md`、`docs/superpowers/plans/2026-09-14-vork-implementation-roadmap-zh-CN.md`  
**前序：** 阶段 1 已交付 FakeModel 对话垂直切片（提交含 `273065a`）

## 1. 目标与边界

### 1.1 目标

交付可在本机 Docker Compose 运行、且镜像与网络模型可迁到腾讯云 Ubuntu 的共享 cloud-computer：受控文件与浏览器工具、实时画面、人工接管、最多三个执行槽，以及并发/资源护栏。验收使用确定性 FakeModel（或固定工具剧本），不接入真实模型供应商。

### 1.2 本阶段不做

- 真实模型、Token 计费产品化、可配置供应商 UI
- 记忆、Skills、审批产品化流程、多 Bot 委派、routines
- 公网 Caddy、备份恢复、macOS 签名公证与自动更新（阶段 4）
- 完整 Linux 桌面环境；云端 Windows/macOS 原生应用
- 将本地 Compose 当作生产部署方案

### 1.3 已确认决策

| 决策 | 选择 |
|------|------|
| 阶段顺序 | 严格阶段 2（云电脑）；真模型留阶段 3 |
| 运行环境 | 本机 Compose 先打通；镜像/网络按可迁腾讯云设计 |
| 交付节奏 | 计划内垂直切片，避免单批大爆炸 |
| 首片工具面 | 文件服务 |
| 首片槽位数 | 1 槽跑通；接口按最多 3 槽设计 |
| 隔离 | 独立 computer 容器；非 root；无 Docker Socket；端口仅内网；服务 token 认证；路径沙箱 |
| 切入方式 | Computer 控制面先行（非先做完整对话 UI 闭环） |
| 真模型 | 本阶段不接；自动化以 FakeModel/固定剧本为准 |

## 2. 架构概览

```text
Electron (画面代理 + 接管 UI)
    |
    | HTTPS/SSE（仅本机 API）
    v
API 网关
    |
    +--> PostgreSQL（任务与事件事实来源）
    +--> Redis/BullMQ（队列）
    +--> Worker（FakeModel + 工具编排 + 租约客户端）
              |
              | Docker 内网 + 服务 token
              v
         computer 容器
           +-- 槽位租约管理（maxSlots ≤ 3）
           +-- 工作区文件服务
           +-- 每槽 Chromium + Profile（切片 2）
           +-- 画面截图接口（切片 2）
           +-- 控制权状态机（切片 2）
```

约束：

- Renderer 不得直连 computer；画面与接管经 API 代理。
- computer 端口不映射到宿主机公网接口；仅 compose 内部网络可达。
- 模型（含 FakeModel）不得直接控制 Docker 或宿主机，只能产出经 Zod 校验的工具调用，由 Worker 调 computer。

## 3. 垂直切片

实施与验收按下列顺序；每一片有独立可测出口，再进入下一片。

### 切片 A：1 槽租约 + 文件服务

**目标：** `apps/computer` 上线；Worker 经认证占用 1 槽并对 Bot 工作区做受控读写；任务事件记录工具进度。

**进程与部署：**

- 新应用：`apps/computer`（HTTP 控制面）。
- Compose 增加 `computer` 服务与工作区命名卷。
- 容器非 root；禁止 `--privileged` 与 Docker Socket 挂载。
- 认证：共享环境变量 `VORK_COMPUTER_TOKEN`（computer 校验、Worker/API 携带）。请求头 `Authorization: Bearer <token>`。缺失或错误 → `401`。mTLS 留阶段 4。

**执行槽（本片 `maxSlots=1`，配置上限设计为 3）：**

- `POST /v1/slots/acquire`：请求体 `{ taskId, botId, kind }`，`kind` 为 `file` | `browser` | `terminal`。
- `kind=terminal`：本阶段**一律**返回 `501`，JSON 错误码 `not_implemented`；不分配槽位、不启动 PTY。PTY 不在阶段 2 范围内；若需要，在阶段 3 开始前另开一切片，本规格不展开。
- 成功返回 `{ slotId, leaseId, expiresAt }`；无空闲槽返回 `503`，错误码 `no_slot`。
- 租约 TTL **60s**；Worker 每 **15s** 调用 `POST /v1/slots/heartbeat` 续租；连续 **2 次**心跳失败视为租约丢失。
- `POST /v1/slots/release` 或租约过期后回收；过期后 computer 拒绝该 `leaseId` 的一切工具调用（`409`，`lease_expired`）。
- 槽位占用真相以 computer 内存状态为准；任务状态以 PostgreSQL 为准；每次 acquire/release/过期通过 Worker 追加任务事件对齐。

**文件工具：**

- 根路径：`/workspace/bots/{bot_id}/`（读写）；`/workspace/shared/` 本阶段**严格只读**，任何 write/mkdir → `403`，错误码 `read_only_root`。
- API（均需有效租约，路径均相对 bot 根或 shared 根）：`list`、`stat`、`read`、`write`、`mkdir`（mkdir 仅允许在 bot 根下）。
- 强制路径规范化，拒绝 `..` 与绝对路径逃逸。
- 上限（本阶段固定值，可配置但默认如下）：单文件 **1 MiB**；单任务累计写入 **10 MiB**；`read` 返回正文同样受 1 MiB 限制，超出截断并在结果中标记 `truncated: true`。
- 文本默认 UTF-8；二进制读需请求体或 query 显式 `encoding=base64`。
- 工具事件类型（写入 `task_events`）：`tool.started`、`tool.finished`、`tool.failed`，payload 经 Zod 校验且不含完整大文件正文（只存路径、大小、截断标记）。

**Worker 本片剧本：** acquire → 固定 `file.write` → `file.read` → 用户可见摘要消息 → `task.complete` → release。

**本片不做：** 浏览器、PTY、三槽、内存高水位、Electron 云电脑面板、真模型、审批。

**本片验收：**

- 健康检查；无 token 被拒。
- 集成：acquire → write → read → release；租约过期可回收。
- 路径逃逸与超限写入失败。
- Worker 跑通剧本并留下单调递增事件。
- `docker compose down`（无 `-v`）保留工作区卷。

### 切片 B：浏览器 + 实时画面 + 人工接管

**目标：** 已占用槽位可启动独立 Chromium；提供观察/动作工具；桌面可展开画面并完成接管互斥。本片仍按 1 槽验收。

**浏览器运行时：**

- 每槽独立 Chromium 与 Profile 目录：`/browser-profiles/{slot_id}`（独立命名卷）。
- Playwright 控制仅容器内网；CDP 不映射到宿主机。
- 释放槽或崩溃处理：结束后端浏览器进程；Profile 保留供同槽复用。本阶段不跨 Bot 共享同一 Profile。

**工具契约：**

- `browser.observe`：页面 ID、URL、标题、加载状态、语义可交互元素、可选截图引用、精简控制台/网络错误。
- 动作至少：`navigate`、`click`、`type`、`scroll`。
- 元素引用短期有效；导航或 DOM 明显变化后必须重新 observe。
- 定位优先级：可访问性角色/名称 → 稳定测试属性 → 文本与 DOM 关系 → 视觉候选 → 坐标。
- 动作后做有限后置条件检查；结果不确定时先核实再重试。自动化使用**仓库内自建静态测试页**，不依赖外部网站。

**实时画面：**

- 本阶段**不**使用 WebSocket/MJPEG；采用 **HTTP 轮询 JPEG 截图**。
- computer 提供 `GET /v1/slots/{slotId}/frame?leaseId=...` → `image/jpeg`（最大宽 **1280px**，等比缩放）。
- API 代理路径：`GET /v1/computer/slots/{slotId}/frame`（API 持 token 转发，响应同样为 JPEG）。
- 桌面展开面板后 Renderer 经 preload 每 **500ms** 请求 API 代理路径；折叠面板时**停止**轮询。
- 对话标题栏「电脑」入口展开面板；默认折叠。
- Renderer 不持有 computer 地址或 token。

**人工接管状态机：**

```text
agent_control → handoff_pending → human_control → agent_control
```

- `human_control` 下禁止 click/type 等输入类动作；允许只读 observe/截图。
- 「交还」回到 `agent_control` 后 FakeModel 剧本才可继续输入类动作。
- CAPTCHA/2FA 不自动破解；剧本可停在「请求接管」事件。

**本片不做：** 真模型、视觉模型主路径、三槽并发、内存 80% 策略、通用桌面、公网 CDP。

**本片验收：**

- 集成：acquire → 打开测试页 → observe → 动作 → 有序事件。
- 接管后输入类工具被拒；交还后可继续。
- 桌面 E2E（**推荐、非阻塞**：集成测试通过即可算切片 B 完成；E2E 失败不挡阶段 2，但应在 CI 或本地加严跑通）：面板可见非空 JPEG；接管状态可切换。
- 单槽浏览器崩溃：见 §8.3「浏览器崩溃恢复」（槽内重启，不 release 租约）。

### 切片 C：三槽并发与资源限制

**目标：** `maxSlots=3`；浏览器重任务并发上限初始为 2；内存高水位停领新浏览器任务；租约/崩溃隔离在多槽下仍成立。

**调度：**

- `kind=file`：占用 1 个执行槽，不计入浏览器并发计数。
- `kind=browser`：占用 1 个执行槽，且计入浏览器并发计数（上限 **2**）。
- 可区分拒绝（HTTP `503`，JSON `code` 字段）：`no_slot`、`browser_concurrency_limit`、`memory_pressure`。
- 上述三种拒绝时：任务状态保持 **`queued`**，追加 `slot.waiting` 事件（含 `reason`）；**不**标 `failed`。
- **排队唤醒（唯一机制）：** Worker 对当前 BullMQ job 调用 BullMQ `moveToDelayed(Date.now() + 5000)`，**固定退避 5s**，**最多 60 次**（约 5 分钟）；超限后任务标 `failed`，事件 `slot.wait_exhausted`。槽位 release **不**触发 Redis pub/sub、不扫描队列、不唤醒其他 job，避免双通道竞态。
- **内存高水位：** computer 读取**容器 cgroup 内存使用率**（非宿主机全局）；≥ **80%** 时拒绝新的 `kind=browser` acquire（`memory_pressure`）。自动化测试通过环境变量 `VORK_MEMORY_PRESSURE=1` 强制开启，不依赖打满真实内存。

**资源限制（本阶段落地范围）：**

- Compose：`computer` 服务 `mem_limit: 4g`、`cpus: 2`（本机开发默认；迁云时可按机器调整，比例思路不变）。
- 工具超时：单次 `browser.navigate` **30s**；单次 `browser.click/type/scroll` **10s**；单次 `file.read/write` **5s**；超时 → `tool.failed`。
- 单文件/单任务写入上限见 §3 切片 A（1 MiB / 10 MiB）。
- **本阶段不落地、不宣称完成：** 进程数上限、磁盘配额 enforcement（记阶段 4 待办）。

**崩溃与恢复：**

- 见 §8.3、§8.4。

**阶段 2 收尾验收：**

- 3 个非浏览器（或 2 浏览器 + 1 文件）任务可并行；第 4 个排队。
- 第 3 个浏览器重任务不得占槽，事件原因明确。
- 压力开关下停领新浏览器任务。
- 切片 A/B 回归通过；`down` 不删卷。

## 4. 与阶段 1 的接口关系

- 继续使用现有 `tasks` / `task_events` 只追加游标模型；扩展事件 type 与 payload schema，不改写历史事件。
- Electron 安全边界不变：`contextIsolation: true`、`nodeIntegration: false`、sandbox preload。
- 根命令保持 `pnpm dev` 启桌面、Compose 启后端；新增 `computer` 健康检查项到 `scripts/dev-healthcheck.mjs`。
- FakeModel 从「纯文本流式回复」扩展为「可产出固定工具调用序列」；真实供应商适配器留阶段 3。

## 5. 测试策略

- 单元：路径沙箱、租约状态机、接管状态下的动作门禁、Zod 契约。
- 集成：computer HTTP + Worker 编排；测试库仍使用独立 `*_test` PostgreSQL 与测试 Valkey，不指向开发数据卷。
- E2E：切片 B/C 按加严项增加桌面场景；默认 CI 可用 FakeModel，不依赖外网页面。
- 常规自动化禁止依赖真实模型；阶段 3 再另设少量真模型冒烟。

## 6. 风险与非目标澄清

- **风险：** 浏览器 E2E 不稳定 → 用自建测试页 + 集成测试为主、桌面 E2E 为加严。
- **风险：** 租约与 DB 任务状态短暂不一致 → 以事件对齐 + 延迟重试收敛，不引入第二套调度总线。
- **非目标：** 本阶段不把「能聊天的真模型」当作完成标准；完成标准是受控工具执行与槽位隔离可验证。

## 7. 后续阶段衔接

- **阶段 3：** 可配置模型供应商、受控 Agent 循环、预算与审批、记忆与 Skills；复用本阶段工具与租约接口。
- **阶段 4：** 腾讯云部署、Caddy、备份、监控、Secret、签名公证；替换开发用 token 为更强认证（如 mTLS）。

## 8. 固定参数与歧义收敛

本节锁定前文「可二选一」表述，实施计划不得再留 TBD。

### 8.1 环境变量（本阶段）

| 变量 | 用途 |
|------|------|
| `VORK_COMPUTER_TOKEN` | Worker/API → computer 的 Bearer token |
| `VORK_COMPUTER_URL` | Worker/API 访问 computer 的内网基址，如 `http://computer:8080` |
| `VORK_MAX_SLOTS` | 默认 `1`（切片 A/B）；切片 C 改为 `3` |
| `VORK_MAX_BROWSER_SLOTS` | 默认 `2`（切片 C 启用） |
| `VORK_MEMORY_PRESSURE` | 测试用：`1` 强制 memory_pressure |
| `VORK_MEMORY_HIGH_WATERMARK` | 默认 `0.8`（80%） |

Compose 内 `computer` **不**向宿主机 `ports` 暴露；仅 `api`、`worker` 与 `computer` 同网络。

### 8.2 任务类型 `kind` 语义

| kind | 占执行槽 | 占浏览器并发名额 | 本阶段 |
|------|----------|------------------|--------|
| `file` | 是 | 否 | 实现 |
| `browser` | 是 | 是 | 切片 B 起实现 |
| `terminal` | — | — | 固定 `501 not_implemented` |

### 8.3 浏览器崩溃恢复（唯一策略）

1. Playwright/Chromium 进程退出且租约仍有效 → computer 在该槽**自动重启浏览器**（同一 Profile），最多 **3 次**，间隔 **2s**。
2. 重启成功 → 追加 `browser.recovered` 事件，任务继续。
3. 3 次均失败 → `POST /v1/slots/release`（若进程仍存活），任务标 **`failed`**，事件 `browser.crashed`；**不**使用 BullMQ 延迟重试（与「等槽位」不同，属于不可恢复故障）。
4. computer 进程整体重启 → 所有内存租约丢失；Worker 下一次工具/心跳收到 `409 lease_expired` 或连接失败 → 任务标 **`failed`**，事件 `lease.lost`；用户需重新发起任务（本阶段不做自动从检查点续跑）。

### 8.4 租约丢失与 computer 重启

- Worker 侧：连续 2 次 heartbeat 失败或工具调用返回 `lease_expired` → 停止当前任务循环，release（best-effort），任务 **`failed`**。
- 工作区卷与 Profile 卷**保留**；不自动重排队同一 taskId。

### 8.5 画面与 API 代理

- 唯一桌面取流路径：`Renderer → preload → API GET /v1/computer/slots/{slotId}/frame → computer GET /v1/slots/{slotId}/frame`。
- 轮询间隔 **500ms**；面板关闭时零请求。
- 截图格式 **JPEG**，最大宽度 **1280px**。

### 8.6 新增任务事件（本阶段）

| 事件 type | 含义 |
|-----------|------|
| `slot.acquired` | 成功占用槽位 |
| `slot.released` | 正常释放 |
| `slot.waiting` | acquire 被拒，任务仍 queued，含 `reason` |
| `slot.wait_exhausted` | 延迟重试 60 次用尽 |
| `browser.recovered` | 槽内浏览器崩溃后重启成功 |
| `browser.crashed` | 浏览器重启 3 次失败，任务 failed |
| `lease.lost` | 租约过期或 computer 重启导致丢失 |
| `tool.started` / `tool.finished` / `tool.failed` | 工具生命周期（切片 A 起） |

### 8.7 阶段 4 待办（本阶段不实现）

- 进程数 cgroup 限制
- 磁盘配额 enforcement
- mTLS 替代 Bearer token
- 公网暴露与 Caddy 终止 TLS
