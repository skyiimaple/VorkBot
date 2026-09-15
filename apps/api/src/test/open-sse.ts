import type { FastifyInstance } from "fastify";

export type SseEvent = {
  id: string;
  event: string;
  data: unknown;
};

function eventFromFrame(frame: string): SseEvent | null {
  const fields = new Map<string, string>();
  for (const line of frame.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1).trimStart());
  }
  const id = fields.get("id");
  const event = fields.get("event");
  const data = fields.get("data");
  if (!id || !event || data === undefined) return null;
  return { id, event, data: JSON.parse(data) };
}

export async function openSse(app: FastifyInstance, url: string, eventCount: number): Promise<{ events: SseEvent[] }> {
  if (!app.server.address()) {
    await app.listen({ host: "127.0.0.1", port: 0 });
  }
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("SSE test server did not expose a TCP address");

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal
  });
  if (!response.ok || !response.body) throw new Error(`SSE request failed with status ${response.status}`);

  const events: SseEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (events.length < eventCount) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffered.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      const event = eventFromFrame(frame);
      if (event) events.push(event);
      if (events.length === eventCount) break;
      boundary = buffered.indexOf("\n\n");
    }
  }
  await reader.cancel();
  controller.abort();
  return { events };
}
