# DeepSeek Agents SDK 实施计划

按用户要求在当前会话直接实施，不提交 Git。

**目标：** 使用已配置的 DeepSeek Key 完成自然语言问答和 Computer 工具调用，审批续跑保留原工具 call_id。

**设计：** `../specs/2026-10-05-deepseek-agents-sdk-design-zh-CN.md`。

## 步骤

- [x] 接入 `@openai/agents`，增加 `agents-sdk-runtime.ts`，测试 Chat Completions 协议、工具、流式回答和 interruption。
- [x] 增加 PostgreSQL SDK 任务状态存储及迁移，测试状态按 user/task 隔离、原始 call_id 去重；迁移外键配置级联删除。
- [x] 增加 `run-sdk-agent-task.ts`，复用 Computer 执行器及 task events；测试原 call_id 审批恢复、取消和副作用保护。
- [x] 默认 Worker 路由改为 `agents-sdk`，每个任务读取用户模型凭据；更新 Compose 与中文启动说明。
- [x] 运行相关测试、类型检查和真实 DeepSeek 验收；清理专用测试数据并关闭本次启动服务。

## 验收记录

- Worker：116 项自动测试通过；真实模型测试默认跳过，避免日常测试扣费。
- 数据库：34 项测试通过；全仓类型检查通过。
- 真实 DeepSeek：2 项验收通过，实际执行 file.write/read、terminal.start/read、browser.navigate/observe、审批后 file.delete；连续问答保留口令。
- SDK 序列化恢复测试验证：模型请求失败后恢复，已成功副作用不重复执行，原始 call_id 不变。
- 新迁移已应用到本地开发数据库；Worker 和 migrate 镜像已重建。未更新其他依赖，未提交 Git。
- 真实验收使用独立 `vork_test` 与临时 Computer 容器，未创建开发库 Bot。验收结束清空测试库，删除临时容器并停止本次启动的 PostgreSQL/Redis；开发数据及命名卷保留。

## 当前边界

- 使用云端浏览器联网，不等同于 OpenAI 托管 web_search；当前页面观察工具的可读信息有限。
- DeepSeek thinking 与 OpenAI tracing 均关闭。
- 尚未进行 Electron 全流程 UI 验收；本次验收覆盖真实 SDK、Worker 适配器、数据库和 Computer 服务。
