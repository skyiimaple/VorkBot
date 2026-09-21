import type { IpcMain, WebContents } from "electron";
import { z } from "zod";
import {
  ApiRequestSchema,
  ApiResponseSchema,
  ComputerFrameRequestSchema,
  ComputerFrameResponseSchema,
  TaskEventMessageSchema,
  TaskSubscriptionSchema,
  type ApiRequest,
  type ApiResponse,
  type ComputerFrameRequest,
  type ComputerFrameResponse
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

  ipcMain.handle("vork:computer-frame", async (_event, rawInput: unknown) => {
    const input = ComputerFrameRequestSchema.parse(rawInput);
    return requestComputerFrame(apiBaseUrl, input, fetchImplementation);
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

async function requestComputerFrame(
  apiBaseUrl: string,
  request: ComputerFrameRequest,
  fetchImplementation: Fetch
): Promise<ComputerFrameResponse> {
  const response = await fetchImplementation(
    new URL(
      `/v1/computer/slots/${encodeURIComponent(request.slotId)}/frame?taskId=${encodeURIComponent(request.taskId)}`,
      apiBaseUrl
    ),
    { headers: { accept: "image/jpeg" } }
  );
  if (!response.ok) throw new Error(`Vork computer frame request failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return ComputerFrameResponseSchema.parse({ base64: bytes.toString("base64") });
}

function apiRequestDetails(request: ApiRequest): { path: string; method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } {
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
    case "cancelTask":
      return {
        path: `/v1/tasks/${encodeURIComponent(request.input.taskId)}/cancel`,
        method: "POST"
      };
    case "listTasks":
      return { path: "/v1/tasks", method: "GET" };
    case "listSkills":
      return { path: "/v1/skills", method: "GET" };
    case "listFiles":
      return { path: "/v1/files", method: "GET" };
    case "listCredentials":
      return { path: "/v1/credentials", method: "GET" };
    case "upsertCredential":
      return { path: "/v1/credentials", method: "PUT", body: request.input };
    case "deleteCredential":
      return { path: "/v1/credentials", method: "DELETE", body: request.input };
  }
}

const TERMINAL_TASK_EVENT_TYPES = new Set(["task.completed", "task.failed", "task.cancelled"]);

async function streamTaskEvents(
  apiBaseUrl: string,
  webContents: WebContents,
  subscription: z.infer<typeof TaskSubscriptionSchema>,
  controller: AbortController,
  fetchImplementation: Fetch,
  retryDelayMs: number
): Promise<void> {
  let afterSequence = subscription.afterSequence;
  let reachedTerminal = false;
  while (!controller.signal.aborted && !webContents.isDestroyed() && !reachedTerminal) {
    try {
      const response = await fetchImplementation(
        new URL(`/v1/tasks/${encodeURIComponent(subscription.taskId)}/events?after=${afterSequence}`, apiBaseUrl),
        { headers: { accept: "text/event-stream" }, signal: controller.signal }
      );
      if (!response.ok || !response.body) throw new Error("Vork task event stream could not be opened");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted && !webContents.isDestroyed() && !reachedTerminal) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const delivered = sendTaskEvent(webContents, subscription.taskId, frame);
          if (delivered.sequence > 0) afterSequence = Math.max(afterSequence, delivered.sequence);
          if (delivered.terminal) {
            reachedTerminal = true;
            controller.abort();
            break;
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error("Vork task event stream failed", error);
    }
    if (!reachedTerminal && !controller.signal.aborted && !webContents.isDestroyed()) await delay(retryDelayMs);
  }
}

function sendTaskEvent(
  webContents: WebContents,
  taskId: string,
  frame: string
): { sequence: number; terminal: boolean } {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return { sequence: 0, terminal: false };
  try {
    const payload = TaskEventMessageSchema.parse({ taskId, event: JSON.parse(data) });
    if (!webContents.isDestroyed()) webContents.send("vork:task-event", payload);
    return {
      sequence: payload.event.sequence,
      terminal: TERMINAL_TASK_EVENT_TYPES.has(payload.event.type)
    };
  } catch {
    // Treat malformed SSE data as untrusted and do not expose it to the renderer.
  }
  return { sequence: 0, terminal: false };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function subscriptionKey(webContentsId: number, taskId: string): SubscriptionKey {
  return `${webContentsId}:${taskId}`;
}
