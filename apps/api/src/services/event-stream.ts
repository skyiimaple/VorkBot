import Redis from "ioredis";
import { TaskEventSchema, type TaskEvent } from "@vork/contracts";
import type { Repositories } from "@vork/database";

const HEARTBEAT_INTERVAL_MS = 20_000;
const TERMINAL_TASK_EVENT_TYPES = new Set(["task.completed", "task.failed", "task.cancelled"]);

export type TaskEventSubscription = {
  close(): Promise<void>;
};

export type TaskEventSubscriber = {
  subscribe(taskId: string, onNotification: () => void): Promise<TaskEventSubscription>;
};

export type TaskEventPublisher = {
  publish(taskId: string): Promise<void>;
};

export type EventStreamWriter = {
  write(chunk: string): boolean;
  end?: () => void;
};

export function taskEventChannel(taskId: string): string {
  return `vork:tasks:${taskId}:events`;
}

export function isTerminalTaskEventType(type: string): boolean {
  return TERMINAL_TASK_EVENT_TYPES.has(type);
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
    try {
      await redis.subscribe(channel);
    } catch (error) {
      redis.off("message", onMessage);
      redis.disconnect();
      throw error;
    }

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

export class RedisTaskEventPublisher implements TaskEventPublisher {
  constructor(private readonly redisUrl: string) {}

  async publish(taskId: string): Promise<void> {
    const redis = new Redis(this.redisUrl);
    try {
      await redis.publish(taskEventChannel(taskId), JSON.stringify({ taskId }));
    } finally {
      redis.disconnect();
    }
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
        if (this.closed) return;
        this.writer.write(": heartbeat\n\n");
        // 心跳顺带从库对齐，避免仅依赖 Redis 唤醒时漏事件（如 API 侧取消）。
        void this.enqueueRefresh().catch(() => void this.close());
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
      if (isTerminalTaskEventType(event.type)) {
        await this.close();
        this.writer.end?.();
        return;
      }
    }
  }
}

function serializeTaskEvent(event: TaskEvent): string {
  const parsedEvent = TaskEventSchema.parse(event);
  return `id: ${parsedEvent.sequence}\nevent: ${parsedEvent.type}\ndata: ${JSON.stringify(parsedEvent)}\n\n`;
}
