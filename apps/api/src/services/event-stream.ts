import Redis from "ioredis";
import type { TaskEvent } from "@vork/contracts";
import type { Repositories } from "@vork/database";

const HEARTBEAT_INTERVAL_MS = 20_000;

export type TaskEventSubscription = {
  close(): Promise<void>;
};

export type TaskEventSubscriber = {
  subscribe(taskId: string, onNotification: () => void): Promise<TaskEventSubscription>;
};

export type EventStreamWriter = {
  write(chunk: string): boolean;
};

export function taskEventChannel(taskId: string): string {
  return `vork:tasks:${taskId}:events`;
}

export class RedisTaskEventSubscriber implements TaskEventSubscriber {
  constructor(private readonly redisUrl: string) {}

  async subscribe(taskId: string, onNotification: () => void): Promise<TaskEventSubscription> {
    const redis = new Redis(this.redisUrl);
    const channel = taskEventChannel(taskId);
    const onMessage = (receivedChannel: string) => {
      if (receivedChannel === channel) onNotification();
    };
    redis.on("message", onMessage);
    await redis.subscribe(channel);

    return {
      async close(): Promise<void> {
        redis.off("message", onMessage);
        try {
          await redis.unsubscribe(channel);
        } finally {
          redis.disconnect();
        }
      }
    };
  }
}

export class TaskEventStream {
  private lastSequence: number;
  private closed = false;
  private subscription: TaskEventSubscription | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private refreshChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repositories: Pick<Repositories, "listTaskEvents">,
    private readonly subscriber: TaskEventSubscriber,
    private readonly writer: EventStreamWriter,
    private readonly taskId: string,
    afterSequence: number
  ) {
    this.lastSequence = afterSequence;
  }

  async open(): Promise<void> {
    await this.refresh();
    if (this.closed) return;

    this.subscription = await this.subscriber.subscribe(this.taskId, () => {
      void this.enqueueRefresh().catch(() => void this.close());
    });
    if (this.closed) {
      await this.subscription.close();
      this.subscription = undefined;
      return;
    }

    await this.refresh();
    if (!this.closed) {
      this.heartbeat = setInterval(() => {
        if (!this.closed) this.writer.write(": heartbeat\n\n");
      }, HEARTBEAT_INTERVAL_MS);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.subscription?.close();
    this.subscription = undefined;
  }

  private enqueueRefresh(): Promise<void> {
    this.refreshChain = this.refreshChain.then(() => this.refresh());
    return this.refreshChain;
  }

  private async refresh(): Promise<void> {
    if (this.closed) return;
    const events = await this.repositories.listTaskEvents(this.taskId, this.lastSequence);
    if (this.closed) return;
    for (const event of events) {
      if (event.sequence <= this.lastSequence) continue;
      this.writer.write(serializeTaskEvent(event));
      this.lastSequence = event.sequence;
    }
  }
}

function serializeTaskEvent(event: TaskEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
