import { expect, test, launchVork } from "./fixtures.js";

test("creates a Bot and restores the streamed reply after restart", async ({ electronApp }, testInfo) => {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { vorkApi?: unknown }).vorkApi)).toBe("object");
  await page.getByRole("button", { name: "新建聊天" }).click();
  await testInfo.attach("recipient-picker", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你好，我是 Vork。")).toBeVisible();
  await testInfo.attach("conversation", { body: await page.screenshot(), contentType: "image/png" });

  await electronApp.close();
  const restarted = await launchVork();
  try {
    await expect((await restarted.firstWindow()).getByText("你好，我是 Vork。")).toBeVisible();
  } finally {
    await restarted.close();
  }
});
