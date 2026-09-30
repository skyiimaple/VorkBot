import { expect, test } from "./fixtures.js";

test("creates a routine, runs it in its dedicated conversation, and keeps the computer hidden", async ({ electronApp }) => {
  test.setTimeout(90_000);
  const routineName = `E2E 定时任务 ${Date.now()}`;
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "新建聊天" }).click();
  await page.getByRole("option", { name: "创建新 Bot" }).click();
  await page.getByRole("button", { name: "本地用户" }).click();
  await page.getByRole("menuitem", { name: "定时任务" }).click();
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect(page.getByLabel("云电脑画面")).toHaveCount(0);

  await page.getByRole("button", { name: "新建" }).click();
  await page.getByLabel("名称").fill(routineName);
  await page.getByRole("combobox", { name: "Bot", exact: true }).selectOption({ index: 1 });
  await page.getByLabel("任务内容").fill("你好");
  await page.getByRole("button", { name: "保存" }).click();
  const routineCard = page.getByRole("listitem").filter({ hasText: routineName });
  await expect(routineCard).toBeVisible();
  await routineCard.getByRole("button", { name: "立即运行" }).click();
  await routineCard.getByRole("button", { name: "打开对话" }).click();
  await expect(page.locator('[data-message-author="assistant"]')).toBeVisible({ timeout: 60_000 });
});

test("automatically dispatches a due one-time routine through the real worker", async ({ electronApp }) => {
  test.setTimeout(45_000);
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const created = await page.evaluate(async (runAt) => {
    const api = (window as unknown as { vorkApi: { request(input: unknown): Promise<any> } }).vorkApi;
    const bots = await api.request({ operation: "listBots", input: {} });
    const bot = bots.data.bots[0];
    if (!bot) throw new Error("E2E requires an existing Bot");
    return api.request({
      operation: "createRoutine",
      input: {
        name: `自动调度 ${Date.now()}`,
        botId: bot.id,
        prompt: "你好",
        trigger: { type: "once", runAt },
        timezone: "Asia/Shanghai"
      }
    });
  }, new Date(Date.now() + 7_000).toISOString());
  const routineId = created.data.routine.id as string;

  await expect.poll(async () => page.evaluate(async (id) => {
    const api = (window as unknown as { vorkApi: { request(input: unknown): Promise<any> } }).vorkApi;
    const history = await api.request({ operation: "listRoutineRuns", input: { routineId: id, limit: 10 } });
    return history.data.runs[0]?.status ?? null;
  }, routineId), { timeout: 30_000 }).toBe("completed");
});
