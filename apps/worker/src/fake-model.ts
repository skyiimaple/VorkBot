import type { ModelInput, ModelProvider } from "./model.js";

/** 默认分片需与冒烟脚本 / E2E 期望的「你好，我是 Vork。」保持一致 */
export const FAKE_MODEL_DEFAULT_CHUNKS = ["你好，", "我是 Vork。"] as const;

export type FakeModelOptions = {
  chunks?: readonly string[];
  /** 分片间隔（毫秒）；生产可设小延迟以便桌面看到流式效果，单测默认 0 */
  delayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeModel implements ModelProvider {
  private readonly chunks: readonly string[];
  private readonly delayMs: number;

  constructor(chunksOrOptions: readonly string[] | FakeModelOptions = FAKE_MODEL_DEFAULT_CHUNKS) {
    if (isChunkList(chunksOrOptions)) {
      this.chunks = chunksOrOptions;
      this.delayMs = 0;
      return;
    }
    this.chunks = chunksOrOptions.chunks ?? FAKE_MODEL_DEFAULT_CHUNKS;
    this.delayMs = Math.max(0, chunksOrOptions.delayMs ?? 0);
  }

  async *streamReply(input: ModelInput): AsyncIterable<string> {
    if (input.signal?.aborted) return;
    for (const chunk of this.chunks) {
      if (input.signal?.aborted) return;
      if (!chunk) continue;
      if (this.delayMs > 0) await sleep(this.delayMs);
      if (input.signal?.aborted) return;
      yield chunk;
    }
  }
}

function isChunkList(value: readonly string[] | FakeModelOptions): value is readonly string[] {
  return Array.isArray(value);
}
