import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeVorkApi } from "../../test/fake-vork-api.js";
import { useConversation } from "./useConversation.js";

const now = "2026-09-15T00:00:00.000Z";

describe("useConversation", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "vorkApi");
  });

  it("merges ordered message deltas and resumes from the latest event sequence", async () => {
    const api = createFakeVorkApi();
    window.vorkApi = api;
    const { result, rerender } = renderHook(() => useConversation("conversation_1"));

    await waitFor(() => expect(result.current.connectionState).toBe("ready"));
    await act(async () => {
      await result.current.sendMessage("你好");
    });

    const taskId = result.current.activeTask?.id;
    expect(taskId).toBeTruthy();
    expect(api.subscribeCalls).toEqual([{ taskId, afterSequence: 0 }]);

    act(() => {
      api.emitTaskEvent(taskId!, { id: "event_2", taskId: taskId!, userId: "user_local", sequence: 2, type: "message.delta", payload: { text: "你" }, createdAt: now });
      api.emitTaskEvent(taskId!, { id: "event_3", taskId: taskId!, userId: "user_local", sequence: 3, type: "message.delta", payload: { text: "好" }, createdAt: now });
    });

    expect(result.current.messages.map((message) => message.content)).toEqual(["你好", "你好"]);
    rerender();
    expect(api.subscribeCalls.at(-1)).toEqual({ taskId, afterSequence: 3 });
  });
});
