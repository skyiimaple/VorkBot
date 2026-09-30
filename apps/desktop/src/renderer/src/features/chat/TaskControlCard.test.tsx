import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskControlCard } from "./TaskControlCard.js";

const task = {
  id: "task_1", userId: "user_local", botId: "bot_1", conversationId: "c", messageId: "m",
  status: "uncertain" as const, pauseRequestedAt: null, retryCount: 0, nextRetryAt: null,
  createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z"
};

describe("TaskControlCard", () => {
  it("offers three explicit choices for an uncertain side effect", () => {
    const onUncertain = vi.fn();
    render(<TaskControlCard controlState={{ task, uncertainToolCall: { id: "tool_1", actionType: "file.write", riskReason: "结果未知", target: "a.txt" } }} pending={false} onApproval={vi.fn()} onUncertain={onUncertain} />);
    fireEvent.click(screen.getByRole("button", { name: "未完成，重试" }));
    expect(onUncertain).toHaveBeenCalledWith("retry");
    expect(screen.getByText("a.txt", { exact: false })).toBeTruthy();
  });
});
