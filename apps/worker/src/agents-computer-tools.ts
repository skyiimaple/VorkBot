import { AgentActionSchema, type AgentToolAction } from "@vork/contracts";

export type AgentsFunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

const string = (description: string, maxLength?: number) => ({
  type: "string",
  description,
  ...(maxLength === undefined ? {} : { maxLength })
});

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): AgentsFunctionToolDefinition => ({
  type: "function",
  name,
  description,
  parameters: { type: "object", properties, required, additionalProperties: false }
});

export const AGENTS_COMPUTER_TOOL_DEFINITIONS: AgentsFunctionToolDefinition[] = [
  tool("vork_file_read", "读取 Bot 工作区中的 UTF-8 文件。路径必须相对工作区。", { path: string("相对文件路径", 512) }, ["path"]),
  tool("vork_file_write", "写入 Bot 工作区文件。", { path: string("相对文件路径", 512), content: string("文件内容", 1_048_576) }, ["path", "content"]),
  tool("vork_file_list", "列出 Bot 工作区目录。", { path: string("相对目录路径，省略表示根目录", 512) }, []),
  tool("vork_file_stat", "获取文件或目录信息。", { path: string("相对路径", 512) }, ["path"]),
  tool("vork_file_mkdir", "创建目录。", { path: string("相对目录路径", 512) }, ["path"]),
  tool("vork_file_move", "移动或重命名文件。此操作可能需要用户批准。", { from: string("源相对路径", 512), to: string("目标相对路径", 512) }, ["from", "to"]),
  tool("vork_file_delete", "删除文件或目录。此操作需要用户批准。", { path: string("相对路径", 512), recursive: { type: "boolean", description: "是否递归删除目录" } }, ["path"]),
  tool("vork_terminal_start", "启动终端会话，可选立即执行命令。", { command: string("启动命令", 20_000) }, []),
  tool("vork_terminal_write", "向终端会话写入输入。", { sessionId: string("终端会话 ID", 128), input: string("输入内容", 100_000) }, ["sessionId", "input"]),
  tool("vork_terminal_read", "读取终端会话的增量输出。", { sessionId: string("终端会话 ID", 128), cursor: { type: "integer", minimum: 0 } }, ["sessionId"]),
  tool("vork_terminal_terminate", "终止终端会话。", { sessionId: string("终端会话 ID", 128) }, ["sessionId"]),
  tool("vork_browser_navigate", "在受控浏览器中打开 URL。", { url: string("完整 URL", 2048) }, ["url"]),
  tool("vork_browser_observe", "读取当前页面标题、URL 和可交互元素。", {}, []),
  tool("vork_browser_click", "点击页面元素引用。", { ref: string("observe 返回的元素引用", 512) }, ["ref"]),
  tool("vork_browser_type", "向页面元素输入文本。", { ref: string("observe 返回的元素引用", 512), text: string("输入文本", 100_000) }, ["ref", "text"]),
  tool("vork_browser_scroll", "滚动当前页面。", { deltaY: { type: "integer", minimum: -100_000, maximum: 100_000 } }, ["deltaY"])
];

const TOOL_ACTION_TYPES = {
  vork_file_read: "file.read",
  vork_file_write: "file.write",
  vork_file_list: "file.list",
  vork_file_stat: "file.stat",
  vork_file_mkdir: "file.mkdir",
  vork_file_move: "file.move",
  vork_file_delete: "file.delete",
  vork_terminal_start: "terminal.start",
  vork_terminal_write: "terminal.write",
  vork_terminal_read: "terminal.read",
  vork_terminal_terminate: "terminal.terminate",
  vork_browser_navigate: "browser.navigate",
  vork_browser_observe: "browser.observe",
  vork_browser_click: "browser.click",
  vork_browser_type: "browser.type",
  vork_browser_scroll: "browser.scroll"
} as const;

export function parseAgentsComputerToolCall(
  name: string,
  arguments_: Record<string, unknown>
): AgentToolAction {
  const type = TOOL_ACTION_TYPES[name as keyof typeof TOOL_ACTION_TYPES];
  if (!type) throw new Error(`UNKNOWN_AGENTS_TOOL: ${name}`);
  return AgentActionSchema.parse({ type, ...arguments_ }) as AgentToolAction;
}
