import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeVorkApi } from "../../test/fake-vork-api.js";
import { useConversation } from "./useConversation.js";

const now = "2026-09-15T00:00:00.000Z";

describe("useConversation", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "vorkApi");
  });

  it("merges ordered message deltas without recreating a healthy subscription", async () => {
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
      api.emitTaskEvent(taskId!, {
        id: "event_2",
        taskId: taskId!,
        userId: "user_local",
        sequence: 2,
        type: "message.delta",
        payload: { text: "你" },
        createdAt: now
      });
      api.emitTaskEvent(taskId!, {
        id: "event_3",
        taskId: taskId!,
        userId: "user_local",
        sequence: 3,
        type: "message.delta",
        payload: { text: "好" },
        createdAt: now
      });
    });

    expect(result.current.messages.map((message) => message.content)).toEqual(["你好", "你好"]);
    rerender();
    expect(api.subscribeCalls).toEqual([{ taskId, afterSequence: 0 }]);
  });

  it("cancels the active task when the user says 停", async () => {
    const api = createFakeVorkApi();
    window.vorkApi = api;
    const { result } = renderHook(() => useConversation("conversation_1"));

    await waitFor(() => expect(result.current.connectionState).toBe("ready"));
    await act(async () => {
      await result.current.sendMessage("请写一篇长文");
    });
    const taskId = result.current.activeTask!.id;
    expect(result.current.working).toBe(true);

    let outcome: Awaited<ReturnType<typeof result.current.sendMessage>> | undefined;
    await act(async () => {
      outcome = await result.current.sendMessage("停");
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(api.request).toHaveBeenCalledWith({ operation: "cancelTask", input: { taskId } });
    expect(result.current.activeTask?.status).toBe("cancelled");
    expect(result.current.working).toBe(false);
  });

  it("creates a named assistant bot from natural language intent", async () => {
    const api = createFakeVorkApi();
    window.vorkApi = api;
    const { result } = renderHook(() => useConversation("conversation_1"));

    await waitFor(() => expect(result.current.connectionState).toBe("ready"));

    let outcome: Awaited<ReturnType<typeof result.current.sendMessage>> | undefined;
    await act(async () => {
      outcome = await result.current.sendMessage("帮我做一个翻译助手");
    });

    expect(outcome?.kind).toBe("assistant-created");
    if (outcome?.kind !== "assistant-created") throw new Error("expected assistant-created");
    expect(outcome.result.botName).toBe("翻译助手");
    expect(api.createBot).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "翻译助手",
        persona: expect.stringContaining("翻译助手")
      })
    );
    expect(api.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "submitMessage" }));
  });

  it("exposes cancelActiveTask for the stop button", async () => {
    const api = createFakeVorkApi();
    window.vorkApi = api;
    const { result } = renderHook(() => useConversation("conversation_1"));

    await waitFor(() => expect(result.current.connectionState).toBe("ready"));
    await act(async () => {
      await result.current.sendMessage("你好");
    });
    const taskId = result.current.activeTask!.id;

    await act(async () => {
      await result.current.cancelActiveTask();
    });

    expect(api.request).toHaveBeenCalledWith({ operation: "cancelTask", input: { taskId } });
    expect(result.current.activeTask?.status).toBe("cancelled");
  });
});
