import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "@vork/database";
import { getTestDatabaseUrl, resetFoundationDatabase } from "@vork/test-support";
import type { ComputerClientLike } from "./computer-client.js";
import { runFileTask } from "./run-file-task.js";
import type { TaskNotifier } from "./queue.js";

describe("runFileTask", () => {
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

  it("writes and reads a demo file through the computer client", async () => {
    const bot = await repos.createBot({ userId: "user_local", name: "File Bot", persona: "文件" });
    const conversation = await repos.createConversation({ userId: "user_local", botId: bot.id });
    const queued = await repos.createQueuedMessageTask({
      userId: "user_local",
      botId: bot.id,
      conversationId: conversation.id,
      content: "[file-demo]"
    });

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
      writeFile: vi.fn(async () => ({ path: "notes/hello.txt", bytes: 36 })),
      readFile: vi.fn(async () => ({
        path: "notes/hello.txt",
        content: "你好，来自云电脑文件工具。",
        bytes: 36
      }))
    };

    await runFileTask(
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
    const events = await repos.listTaskEvents(queued.task.id, 0);
    expect(events.map((event) => event.type)).toEqual([
      "task.queued",
      "task.running",
      "slot.acquired",
      "tool.started",
      "tool.finished",
      "tool.started",
      "tool.finished",
      "slot.released",
      "message.completed",
      "task.completed"
    ]);
    expect(computer.release).toHaveBeenCalledWith("lease_1");
  });
});
