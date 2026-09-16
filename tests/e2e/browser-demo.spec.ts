import { expect, test } from "./fixtures.js";

test("opens the computer panel and can send a browser demo prompt", async ({ electronApp }, testInfo) => {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { vorkApi?: unknown }).vorkApi)).toBe("object");

  await page.getByRole("button", { name: "新建聊天" }).click();
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("button", { name: "电脑" }).click();
  await expect(page.getByLabel("云电脑画面")).toBeVisible();
  await testInfo.attach("computer-panel", { body: await page.screenshot(), contentType: "image/png" });

  await page.getByRole("textbox", { name: "消息" }).fill("[browser-demo]");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText(/浏览器演示完成|任务：/)).toBeVisible({ timeout: 60_000 });
});
