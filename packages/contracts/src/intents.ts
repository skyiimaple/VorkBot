/**
 * 用户意图识别（取消任务 / 创建助手）。
 * 规则与 `skills/create-assistant/SKILL.md`、`skills/cancel-task/SKILL.md` 对齐。
 */

export type CreateAssistantIntent = {
  topic: string;
  botName: string;
  systemPrompt: string;
};

const CANCEL_UTTERANCE =
  /^(?:取消|停下?来?|停止|中断|别说了|不要了|别生成了|stop|cancel|abort)[!！.。…]*$/i;

/** 当前会话有 running/queued 任务时，识别「停 / 取消」等短指令。 */
export function isCancelUtterance(content: string): boolean {
  return CANCEL_UTTERANCE.test(content.trim());
}

const CREATE_ASSISTANT_PATTERNS: RegExp[] = [
  /(?:请)?(?:帮我|给我|为我)?(?:做|创建|建|弄|生成)(?:一个|个)?\s*(.+?)\s*助手/,
  /我需要(?:一个|个)?\s*(.+?)\s*助手/,
  /我想要(?:一个|个)?\s*(.+?)\s*助手/,
  /需要(?:一个|个)?\s*(.+?)\s*助手/
];

const NON_TOPIC = /^(?:什么|哪个|怎样|如何|这个|那个|你|我|一个|个)$/;

/** 识别「需要一个 XX 助手 / 帮我做一个翻译助手」等建助手意图。 */
export function parseCreateAssistantIntent(content: string): CreateAssistantIntent | null {
  const text = content.trim().replace(/\s+/g, " ");
  if (!text || text.length > 200) return null;
  // 问答/元对话：不要误触发
  if (/(?:是什么|什么意思|怎么用|如何使用|你是|这是|那个助手)/.test(text) && !/(?:帮我|给我|为我|我需要|我想要|创建|做一)/.test(text)) {
    return null;
  }

  for (const pattern of CREATE_ASSISTANT_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const topic = normalizeTopic(match[1]);
    if (!topic || NON_TOPIC.test(topic) || topic.length > 40) continue;
    const botName = topic.endsWith("助手") ? topic : `${topic}助手`;
    return {
      topic: topic.replace(/助手$/, "") || topic,
      botName,
      systemPrompt: buildAssistantSystemPrompt(botName, topic.replace(/助手$/, "") || topic)
    };
  }
  return null;
}

function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^的/, "")
    .replace(/[「」『』""'']/g, "")
    .replace(/[，。！？、,.!?]+$/g, "")
    .trim();
}

export function buildAssistantSystemPrompt(botName: string, topic: string): string {
  return [
    `你是「${botName}」。`,
    `角色：专注于「${topic}」相关任务，用清晰、可执行的方式帮助用户。`,
    "边界：只在该主题能力范围内回答；超出范围时明确说明限制，不要假装能完成。",
    "风格：简洁、分点、避免空话；需要澄清时先问一个关键问题。",
    "工具偏好：优先文字步骤与示例；仅当用户明确需要文件或浏览器操作时，再提示使用对应演示能力。"
  ].join("\n");
}
