import { expect, test, launchVork } from "./fixtures.js";

test("creates a Bot and restores the streamed reply after restart", async ({ electronApp }, testInfo) => {
  test.setTimeout(90_000);
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { vorkApi?: unknown }).vorkApi)).toBe("object");
  await page.getByRole("button", { name: "新建聊天" }).click();
  await testInfo.attach("recipient-picker", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("textbox", { name: "消息" }).fill("你好");
  await page.getByRole("button", { name: "发送" }).click();
  const assistantReply = page.locator('[data-message-author="assistant"] [data-assistant-markdown="true"]').last();
  const stopButton = page.getByRole("button", { name: "停止" });
  await expect(stopButton).toBeVisible();
  await expect(stopButton).toBeHidden({ timeout: 60_000 });
  let previousReply = "";
  await expect
    .poll(async () => {
      const currentReply = (await assistantReply.innerText()).trim();
      const stable = currentReply.length > 0 && currentReply === previousReply;
      previousReply = currentReply;
      return stable;
    })
    .toBe(true);
  const replyText = (await assistantReply.innerText()).trim();
  const conversationHash = await page.evaluate(() => window.location.hash);
  await testInfo.attach("conversation", { body: await page.screenshot(), contentType: "image/png" });

  await electronApp.close();
  const restarted = await launchVork();
  try {
    const restartedPage = await restarted.firstWindow();
    await restartedPage.evaluate((hash) => {
      window.location.hash = hash;
    }, conversationHash);
    const restoredReply = restartedPage
      .locator('[data-message-author="assistant"] [data-assistant-markdown="true"]')
      .last();
    await expect(restoredReply).toHaveText(replyText);
  } finally {
    await restarted.close();
  }
});
