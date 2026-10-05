# Vork Agents API Runtime 设计

## 目标

将 Vork 的默认聊天与 Agent 编排迁移到 OpenAI Agents API，同时保留 Electron、PostgreSQL、BullMQ、任务事件、Routines 与 Vork Computer。旧的本地运行时保留为显式回退，不再作为默认路径。

## 架构

- 一个 Vork `conversation` 对应一个 OpenAI Agents API `session`。
- 一个 Vork `task` 对应 Session 中由用户消息启动的一个 turn。
- Worker 负责创建或继续 Session、消费流式事件，并将文本增量转换成现有 `message.delta`。
- Agents API 使用 `environment: none`；第一切片启用托管 `web_search`，不改变 Computer 镜像。
- PostgreSQL 保存 Session 映射。OpenAI Session 是 Agent 上下文事实来源，Vork 继续保存用户可见消息和业务任务状态。
- 缺少 Agents API 凭据时任务以明确错误失败，不静默切换到普通文本模型。

## 兼容性

- `VORK_AGENT_RUNTIME=openai-agents` 为默认值；设置为 `legacy` 可回退现有执行路径。
- Agents API 使用独立的 `OPENAI_API_KEY`、`OPENAI_AGENT_MODEL` 与可选 `OPENAI_BASE_URL`，不复用 OpenAI-compatible/DeepSeek 凭据。
- 旧 `agent-loop`、审批、Computer 工具和测试标记暂时保留，后续作为 Function Tools 接入后再清理。

## 数据与失败处理

- 新表 `agent_sessions` 对 `(user_id, conversation_id, runtime)` 建唯一约束。
- Session 创建完成后立即持久化外部 ID；并发创建由数据库 upsert 收敛。
- 成功必须观察到 `agent.session.turn.completed` 且获得非空回复。
- `turn.failed`、`turn.cancelled`、`session.failed`、流断开或空回复都转成稳定的 Vork 错误码。
- Session 不存在或已失效时删除本地映射并重建一次；其他错误不自动重放，避免重复副作用。

## 第一切片验收

1. 默认 Runtime 是 Agents API，旧 Runtime 只能显式开启。
2. 首条消息创建 Session，后续消息复用同一 Session。
3. 文本流继续通过现有 SSE/UI 渐进显示并最终落库。
4. Agent 配置包含 `web_search`。
5. Session 映射持久化，Worker 重启后仍可继续对话。
6. 单元测试、数据库集成测试和 Worker 类型检查通过。

