import type { IpcMain, WebContents } from "electron";
import { z } from "zod";
import {
  ApiRequestSchema,
  ApiResponseSchema,
  TaskEventMessageSchema,
  TaskSubscriptionSchema,
  type ApiRequest,
  type ApiResponse
} from "../preload/api.js";

const ApiBaseUrlSchema = z.enum(["http://127.0.0.1:3000", "http://localhost:3000"]);
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const EVENT_RETRY_DELAY_MS = 250;

type Fetch = typeof fetch;
type SubscriptionKey = `${number}:${string}`;

export function resolveApiBaseUrl(environment = process.env): string {
  return ApiBaseUrlSchema.parse(environment.VORK_API_BASE_URL ?? DEFAULT_API_BASE_URL);
}

export function registerApiIpc(ipcMain: IpcMain, fetchImplementation: Fetch = fetch, eventRetryDelayMs = EVENT_RETRY_DELAY_MS): void {
  const apiBaseUrl = resolveApiBaseUrl();
  const subscriptions = new Map<SubscriptionKey, AbortController>();

  ipcMain.handle("vork:request", async (_event, rawInput: unknown) => {
    const input = ApiRequestSchema.parse(rawInput);
    return requestApi(apiBaseUrl, input, fetchImplementation);
  });

  ipcMain.on("vork:subscribe-task", (event, rawInput: unknown) => {
    const subscription = TaskSubscriptionSchema.parse(rawInput);
    const key = subscriptionKey(event.sender.id, subscription.taskId);
    subscriptions.get(key)?.abort();
    const controller = new AbortController();
    const abortOnDestroy = () => controller.abort();
    event.sender.once("destroyed", abortOnDestroy);
    subscriptions.set(key, controller);
    void streamTaskEvents(apiBaseUrl, event.sender, subscription, controller, fetchImplementation, eventRetryDelayMs).finally(() => {
      event.sender.removeListener("destroyed", abortOnDestroy);
      if (subscriptions.get(key) === controller) subscriptions.delete(key);
    });
  });

  ipcMain.on("vork:unsubscribe-task", (event, rawInput: unknown) => {
    const subscription = TaskSubscriptionSchema.parse(rawInput);
    subscriptions.get(subscriptionKey(event.sender.id, subscription.taskId))?.abort();
  });
}

async function requestApi(apiBaseUrl: string, request: ApiRequest, fetchImplementation: Fetch): Promise<ApiResponse> {
  const { path, method, body } = apiRequestDetails(request);
  const response = await fetchImplementation(new URL(path, apiBaseUrl), {
    method,
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error(`Vork API request failed with ${response.status}`);
  return ApiResponseSchema.parse({ operation: request.operation, data: await response.json() });
}

function apiRequestDetails(request: ApiRequest): { path: string; method: "GET" | "POST"; body?: unknown } {
  switch (request.operation) {
    case "listBots":
      return { path: "/v1/bots", method: "GET" };
    case "listConversations":
      return { path: "/v1/conversations", method: "GET" };
    case "createBot":
      return { path: "/v1/bots", method: "POST", body: request.input };
    case "createConversation":
      return { path: "/v1/conversations", method: "POST", body: request.input };
    case "listMessages":
      return { path: `/v1/conversations/${encodeURIComponent(request.input.conversationId)}/messages`, method: "GET" };
    case "submitMessage":
      return {
        path: `/v1/conversations/${encodeURIComponent(request.input.conversationId)}/messages`,
        method: "POST",
        body: { content: request.input.content }
      };
  }
}

async function streamTaskEvents(
  apiBaseUrl: string,
  webContents: WebContents,
  subscription: z.infer<typeof TaskSubscriptionSchema>,
  controller: AbortController,
  fetchImplementation: Fetch,
  retryDelayMs: number
): Promise<void> {
  let afterSequence = subscription.afterSequence;
  while (!controller.signal.aborted && !webContents.isDestroyed()) {
    try {
      const response = await fetchImplementation(
        new URL(`/v1/tasks/${encodeURIComponent(subscription.taskId)}/events?after=${afterSequence}`, apiBaseUrl),
        { headers: { accept: "text/event-stream" }, signal: controller.signal }
      );
      if (!response.ok || !response.body) throw new Error("Vork task event stream could not be opened");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted && !webContents.isDestroyed()) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) afterSequence = Math.max(afterSequence, sendTaskEvent(webContents, subscription.taskId, frame));
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error("Vork task event stream failed", error);
    }
    if (!controller.signal.aborted && !webContents.isDestroyed()) await delay(retryDelayMs);
  }
}

function sendTaskEvent(webContents: WebContents, taskId: string, frame: string): number {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return 0;
  try {
    const payload = TaskEventMessageSchema.parse({ taskId, event: JSON.parse(data) });
    if (!webContents.isDestroyed()) webContents.send("vork:task-event", payload);
    return payload.event.sequence;
  } catch {
    // Treat malformed SSE data as untrusted and do not expose it to the renderer.
  }
  return 0;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function subscriptionKey(webContentsId: number, taskId: string): SubscriptionKey {
  return `${webContentsId}:${taskId}`;
}
