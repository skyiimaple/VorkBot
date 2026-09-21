import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { ComputerClientLike } from "./computer-client.js";
import { runBrowserTask } from "./run-browser-task.js";
import type { TaskNotifier } from "./queue.js";

describe("runBrowserTask", () => {
  const databaseUrl = getTestDatabaseUrl();
  const repos = createRepositories({ databaseUrl });
  const notifiedTaskIds: string[] = [];
  const notifier: TaskNotifier = {
    notify: async (taskId) => void notifiedTaskIds.push(taskId)
  };

  beforeEach(async () => {
    notifiedTaskIds.length = 0;
    await resetFoundationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await repos.close();
  });

  it("navigates the demo page and performs click/type actions", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "Browser Bot", persona: "浏览器" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repos.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content: "[browser-demo]"
    });

    const observed = {
      pageId: "page_1",
      url: "file:///app/public/test-page/index.html",
      title: "Vork Browser Test",
      loadState: "loaded" as const,
      elements: [
        { ref: "el_1", role: "button", name: "Click me", tag: "button", testId: "demo-action" },
        { ref: "el_2", tag: "input", name: "Type here", testId: "demo-input" }
      ],
      consoleErrors: [] as string[]
    };

    const computer: ComputerClientLike = {
      acquire: vi.fn(async () => ({
        slotId: "slot_1",
        leaseId: "lease_1",
        expiresAt: "2026-09-16T00:01:00.000Z"
      })),
      heartbeat: vi.fn(async () => ({
        slotId: "slot_1",
        leaseId: "lease_1",
        expiresAt: "2026-09-16T00:02:00.000Z"
      })),
      release: vi.fn(async () => {}),
      writeFile: vi.fn(async () => ({ path: "notes/hello.txt", bytes: 1 })),
      readFile: vi.fn(async () => ({ path: "notes/hello.txt", content: "x", bytes: 1 })),
      observe: vi.fn(async () => observed),
      navigate: vi.fn(async () => ({ url: observed.url })),
      click: vi.fn(async () => ({ ref: "el_1" })),
      type: vi.fn(async () => ({ ref: "el_2" }))
    };

    await runBrowserTask(
      {
        taskId: queued.task.id,
        userId: queued.task.userId,
        botId: queued.task.botId,
        conversationId: queued.task.conversationId,
        messageId: queued.task.messageId
      },
      { repos, computer, notifier }
    );

    const task = await repos.getTask(queued.task.id);
    expect(task?.status).toBe("completed");
    expect(computer.navigate).toHaveBeenCalledWith("lease_1", "file:///app/public/test-page/index.html");
    expect(computer.click).toHaveBeenCalledWith("lease_1", "el_1");
    expect(computer.type).toHaveBeenCalledWith("lease_1", "el_2", "hello from vork");

    const events = await repos.listTaskEvents(queued.task.id, 0);
    expect(events.map((event) => event.type)).toEqual([
      "task.queued",
      "task.running",
      "slot.acquired",
      "tool.started",
      "tool.finished",
      "tool.started",
      "tool.finished",
      "tool.started",
      "tool.finished",
      "tool.started",
      "tool.finished",
      "slot.released",
      "message.completed",
      "task.completed"
    ]);
  });
});
