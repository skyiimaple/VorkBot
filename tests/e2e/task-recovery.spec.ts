import { expect, test } from "./fixtures.js";

test("pauses at an action boundary and resumes to completion", async ({ electronApp }) => {
  test.setTimeout(90_000);
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "新建聊天" }).click();
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("[agent-pause]");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "暂停任务" }).click();
  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "恢复任务" }).click();
  await expect(page.getByText("已通过 Agent 循环写入并读取 notes/agent-hello.txt。" )).toBeVisible({ timeout: 60_000 });
});

test("asks the user to resolve an uncertain side effect", async ({ electronApp }) => {
  test.setTimeout(90_000);
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "新建聊天" }).click();
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("[agent-uncertain]");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByLabel("结果不确定")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "未完成，重试" }).click();
  await expect(page.getByText("已处理结果不确定的文件操作。" )).toBeVisible({ timeout: 60_000 });
});
