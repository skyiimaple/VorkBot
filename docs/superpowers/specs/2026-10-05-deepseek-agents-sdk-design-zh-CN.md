# DeepSeek 与 Agents SDK 接入设计

用户已确认使用 DeepSeek。主运行层从 OpenAI 托管 Agents API 改为 Worker 内的 Agents SDK；Electron、Bot、对话、定时任务及 Computer 接口继续复用。

## 运行与凭据

- 默认 `VORK_AGENT_RUNTIME=agents-sdk`，使用 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`；数据库内用户保存的模型凭据优先于环境默认值，每个任务读取最新配置。
- SDK 使用 Chat Completions 适配器调用 DeepSeek，禁用发往 OpenAI 的 tracing；DeepSeek 首版关闭 thinking，避免遗漏 reasoning_content 导致工具续跑被拒绝。
- 保留显式 `openai-agents` 和 `legacy` 路径，原远端 session 不删除。

## 状态与工具

- 任务 SDK RunState 和恢复所需历史保存在 PostgreSQL，每次模型响应和工具执行后保存。
- 工具定义复用现有 Computer Function Tools。低风险操作自动执行；需要批准的操作使用 SDK interruption，原始 call_id 随 RunState 保存。批准后恢复同一 RunState，不改写成新用户消息。
- 工具顺序执行，副作用不确定时保留 `uncertain` 状态。重复恢复不能自动重跑已成功的副作用；执行中断需从持久化记录恢复或转人工确认。
- 支持任务取消及暂停，纯问答不申请 Computer 槽位。浏览器、终端、文件工具按需申请槽位并最终释放。
- 搜索通过现有浏览器工具访问页面；不宣称拥有 OpenAI 托管 web_search。

## 验收

离线验证普通问答路由、历史、工具调用、审批后原 call_id、恢复、取消和不确定副作用。真实 DeepSeek 验证问答、连续会话、文件写读、终端和浏览器。使用专用测试 Bot 与测试数据库，清理测试数据及本次启动服务，不提交 Git。
