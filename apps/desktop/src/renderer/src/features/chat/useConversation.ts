import type { Message, Task, TaskControlState, TaskEvent, UncertainResolutionInput } from "@vork/contracts";
import { isCancelUtterance, parseCreateAssistantIntent } from "@vork/contracts";
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { VorkApi } from "../../../../preload/api.js";

export type ConnectionState = "loading" | "ready" | "error";

export type CreateAssistantResult = {
  botId: string;
  conversationId: string;
  botName: string;
};

const VorkApiContext = createContext<VorkApi | undefined>(undefined);

export function VorkApiProvider({ api, children }: { api: VorkApi; children: ReactNode }) {
  return createElement(VorkApiContext.Provider, { value: api }, children);
}

export function useVorkApi(): VorkApi {
  const contextualApi = useContext(VorkApiContext);
  const api = contextualApi ?? (typeof window !== "undefined" ? window.vorkApi : undefined);
  if (!api) throw new Error("VorkApi is not available");
  return api;
}

function isActiveTaskStatus(status: Task["status"]): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval" || status === "paused" || status === "uncertain";
}

export function useConversation(conversationId: string) {
  const api = useVorkApi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTask, setActiveTask] = useState<Task>();
  const [controlState, setControlState] = useState<TaskControlState>();
  const [isControlPending, setControlPending] = useState(false);
  const [activeSlotId, setActiveSlotId] = useState<string>();
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const lastSequence = useRef(0);
  const activeTaskRef = useRef<Task | undefined>(undefined);

  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);

  useEffect(() => {
    let cancelled = false;
    lastSequence.current = 0;
    setActiveTask(undefined);
    setActiveSlotId(undefined);
    setConnectionState("loading");
    void Promise.all([
      api.request({ operation: "listMessages", input: { conversationId } }),
      api.request({ operation: "getActiveTask", input: { conversationId } })
    ]).then(
      ([messagesResponse, taskResponse]) => {
        if (cancelled || messagesResponse.operation !== "listMessages" || taskResponse.operation !== "getActiveTask") return;
        setMessages(messagesResponse.data.messages);
        setControlState(taskResponse.data.controlState ?? undefined);
        setActiveTask(taskResponse.data.controlState?.task);
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
    let cancelled = false;
    const unsubscribe = api.subscribeTask(activeTask.id, lastSequence.current, (event) => {
      if (event.sequence <= lastSequence.current) return;
      lastSequence.current = event.sequence;
      mergeTaskEvent(event, conversationId, setMessages, setActiveTask, setActiveSlotId);
      if (["task.pause_requested", "task.paused", "task.resumed", "approval.request", "tool.uncertain", "tool.uncertain_resolved"].includes(event.type)) {
        void api.request({ operation: "getTaskControlState", input: { taskId: event.taskId } }).then((response) => {
          if (!cancelled && response.operation === "getTaskControlState") {
            setControlState(response.data);
            setActiveTask(response.data.task);
          }
        });
      }
      if (event.type === "message.completed") {
        void api.request({ operation: "listMessages", input: { conversationId } }).then((response) => {
          if (!cancelled && response.operation === "listMessages") setMessages(response.data.messages);
        });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeTask?.id, api, conversationId]);

  const cancelActiveTask = useCallback(async () => {
    const task = activeTaskRef.current;
    if (!task || !isActiveTaskStatus(task.status)) return;
    const response = await api.request({ operation: "cancelTask", input: { taskId: task.id } });
    if (response.operation !== "cancelTask") throw new Error("Unexpected Vork API response");
    setActiveTask((current) =>
      current && current.id === response.data.task.id ? { ...current, ...response.data.task } : current
    );
    setControlState(undefined);
  }, [api]);

  const mutateControl = useCallback(async (operation: "pauseTask" | "resumeTask") => {
    const task = activeTaskRef.current;
    if (!task) return;
    setControlPending(true);
    try {
      const response = await api.request({ operation, input: { taskId: task.id } });
      if (response.operation !== operation) throw new Error("Unexpected Vork API response");
      setActiveTask(response.data.task);
      setControlState((current) => ({ ...(current ?? {}), task: response.data.task }));
    } finally {
      setControlPending(false);
    }
  }, [api]);

  const resolveApproval = useCallback(async (decision: "approve" | "reject") => {
    const task = activeTaskRef.current;
    if (!task) return;
    setControlPending(true);
    try {
      const response = await api.request({ operation: "resolveApproval", input: { taskId: task.id, decision } });
      if (response.operation !== "resolveApproval") throw new Error("Unexpected Vork API response");
      setActiveTask(response.data.task);
      setControlState({ task: response.data.task });
    } finally { setControlPending(false); }
  }, [api]);

  const resolveUncertain = useCallback(async (resolution: UncertainResolutionInput["resolution"]) => {
    const task = activeTaskRef.current;
    if (!task) return;
    setControlPending(true);
    try {
      const response = await api.request({ operation: "resolveUncertain", input: { taskId: task.id, resolution } });
      if (response.operation !== "resolveUncertain") throw new Error("Unexpected Vork API response");
      setActiveTask(response.data.task);
      setControlState({ task: response.data.task });
    } finally { setControlPending(false); }
  }, [api]);

  const createAssistantFromIntent = useCallback(
    async (content: string): Promise<CreateAssistantResult | null> => {
      const intent = parseCreateAssistantIntent(content);
      if (!intent) return null;
      const response = await api.request({
        operation: "createBot",
        input: { name: intent.botName, persona: intent.systemPrompt }
      });
      if (response.operation !== "createBot") throw new Error("Unexpected Vork API response");
      return {
        botId: response.data.bot.id,
        conversationId: response.data.conversation.id,
        botName: response.data.bot.name
      };
    },
    [api]
  );

  const sendMessage = useCallback(
    async (content: string): Promise<{ kind: "message" } | { kind: "cancelled" } | { kind: "assistant-created"; result: CreateAssistantResult }> => {
      const trimmed = content.trim();
      const currentTask = activeTaskRef.current;
      if (currentTask && isActiveTaskStatus(currentTask.status) && isCancelUtterance(trimmed)) {
        await cancelActiveTask();
        return { kind: "cancelled" };
      }

      const created = await createAssistantFromIntent(trimmed);
      if (created) {
        return { kind: "assistant-created", result: created };
      }

      const response = await api.request({ operation: "submitMessage", input: { conversationId, content: trimmed } });
      if (response.operation !== "submitMessage") throw new Error("Unexpected Vork API response");
      setMessages((current) => [...current, response.data.message]);
      lastSequence.current = 0;
      setActiveSlotId(undefined);
      setActiveTask(response.data.task);
      return { kind: "message" };
    },
    [api, cancelActiveTask, conversationId, createAssistantFromIntent]
  );

  return {
    messages,
    activeTask,
    controlState,
    activeSlotId,
    sendMessage,
    cancelActiveTask,
    pauseActiveTask: () => mutateControl("pauseTask"),
    resumeActiveTask: () => mutateControl("resumeTask"),
    resolveApproval,
    resolveUncertain,
    isControlPending,
    connectionState,
    api,
    working: Boolean(activeTask && (activeTask.status === "queued" || activeTask.status === "running"))
  };
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
  if (type === "task.queued") return "queued";
  if (type === "task.running") return "running";
  if (type === "approval.request") return "waiting_approval";
  if (type === "task.paused") return "paused";
  if (type === "task.resumed") return "queued";
  if (type === "tool.uncertain") return "uncertain";
  if (type === "task.completed") return "completed";
  if (type === "task.failed") return "failed";
  if (type === "task.cancelled") return "cancelled";
  return undefined;
}
