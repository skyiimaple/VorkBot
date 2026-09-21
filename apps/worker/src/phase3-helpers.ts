/** 第二次成功任务时建议生成 Skill 草稿；不自动发布。 */
export function shouldSuggestSkillDraft(priorCompletedCount: number): boolean {
  return priorCompletedCount + 1 === 2;
}

export function buildSkillDraft(input: { userText: string; assistantText: string }): { name: string; summary: string } {
  const topic = input.userText.replace(/\s+/g, " ").trim().slice(0, 40) || "未命名任务";
  const summary = input.assistantText.replace(/\s+/g, " ").trim().slice(0, 280) || "成功完成任务。";
  return {
    name: `${topic} 流程`,
    summary
  };
}

export function workingMemorySummary(reply: string): string {
  const text = reply.replace(/\s+/g, " ").trim().slice(0, 280);
  return text ? `任务摘要：${text}` : "任务已完成。";
}

/** 列表与日志只展示尾部，绝不回传完整密钥。 */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  return `****${tail}`;
}
