import type { Message, Task, TaskEvent } from "@vork/contracts";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { VorkApi } from "../../../../preload/api.js";

export type ConnectionState = "loading" | "ready" | "error";

const VorkApiContext = createContext<VorkApi | undefined>(undefined);

export function VorkApiProvider({ api, children }: { api: VorkApi; children: ReactNode }) {
  return createElement(VorkApiContext.Provider, { value: api }, children);
}

export function useConversation(conversationId: string) {
  const contextualApi = useContext(VorkApiContext);
  const api = contextualApi ?? window.vorkApi;
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTask, setActiveTask] = useState<Task>();
  const [activeSlotId, setActiveSlotId] = useState<string>();
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const lastSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    lastSequence.current = 0;
    setActiveTask(undefined);
    setActiveSlotId(undefined);
    setConnectionState("loading");
    void api.request({ operation: "listMessages", input: { conversationId } }).then(
      (response) => {
        if (cancelled || response.operation !== "listMessages") return;
        setMessages(response.data.messages);
        setConnectionState("ready");
      },
      () => {
        if (!cancelled) setConnectionState("error");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api, conversationId]);

  useEffect(() => {
    if (!activeTask) return;
    return api.subscribeTask(activeTask.id, lastSequence.current, (event) => {
      if (event.sequence <= lastSequence.current) return;
      lastSequence.current = event.sequence;
      mergeTaskEvent(event, conversationId, setMessages, setActiveTask, setActiveSlotId);
    });
  }, [activeTask?.id, api, conversationId]);

  const sendMessage = useCallback(
    async (content: string) => {
      const response = await api.request({ operation: "submitMessage", input: { conversationId, content } });
      if (response.operation !== "submitMessage") throw new Error("Unexpected Vork API response");
      setMessages((current) => [...current, response.data.message]);
      lastSequence.current = 0;
      setActiveSlotId(undefined);
      setActiveTask(response.data.task);
    },
    [api, conversationId]
  );

  return { messages, activeTask, activeSlotId, sendMessage, connectionState, api };
}

function mergeTaskEvent(
  event: TaskEvent,
  conversationId: string,
  setMessages: (update: (messages: Message[]) => Message[]) => void,
  setActiveTask: (update: (task: Task | undefined) => Task | undefined) => void,
  setActiveSlotId: (update: (slotId: string | undefined) => string | undefined) => void
): void {
  if (event.type === "message.delta") {
    const text = messageDeltaText(event.payload);
    if (!text) return;
    setMessages((current) => {
      const id = `stream-${event.taskId}`;
      const draft = current.find((message) => message.id === id);
      if (draft) return current.map((message) => (message.id === id ? { ...message, content: message.content + text } : message));
      return [...current, { id, userId: event.userId, conversationId, authorType: "assistant", content: text, createdAt: event.createdAt }];
    });
  }
  if (event.type === "slot.acquired") {
    const slotId = slotIdFromPayload(event.payload);
    if (slotId) setActiveSlotId(() => slotId);
  }
  if (event.type === "slot.released") {
    setActiveSlotId(() => undefined);
  }
  const status = taskStatusFor(event.type);
  if (status) setActiveTask((task) => (task && task.id === event.taskId ? { ...task, status, updatedAt: event.createdAt } : task));
}

function messageDeltaText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("text" in payload)) return undefined;
  const text = (payload as { text: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function slotIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("slotId" in payload)) return undefined;
  const slotId = (payload as { slotId: unknown }).slotId;
  return typeof slotId === "string" && slotId.length > 0 ? slotId : undefined;
}

function taskStatusFor(type: string): Task["status"] | undefined {
  if (type === "task.running") return "running";
  if (type === "task.completed") return "completed";
  if (type === "task.failed") return "failed";
  if (type === "task.cancelled") return "cancelled";
  return undefined;
}
