import { describe, expect, it } from "vitest";
import { buildSkillDraft, maskSecret, shouldSuggestSkillDraft, workingMemorySummary } from "./phase3-helpers.js";

describe("phase 3 helpers", () => {
  it("suggests a skill draft only on the second success", () => {
    expect(shouldSuggestSkillDraft(0)).toBe(false);
    expect(shouldSuggestSkillDraft(1)).toBe(true);
    expect(shouldSuggestSkillDraft(2)).toBe(false);
  });

  it("builds a draft from task text without enabling it", () => {
    expect(buildSkillDraft({ userText: "整理笔记", assistantText: "已写入 notes。" })).toEqual({
      name: "整理笔记 流程",
      summary: "已写入 notes。"
    });
  });

  it("masks secrets to a four-character tail", () => {
    expect(maskSecret("sk-live-secret-value")).toBe("****alue");
    expect(workingMemorySummary("完成了文件整理")).toBe("任务摘要：完成了文件整理");
  });
});
