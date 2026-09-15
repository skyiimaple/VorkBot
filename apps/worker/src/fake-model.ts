import type { ModelInput, ModelProvider } from "./model.js";

export class FakeModel implements ModelProvider {
  constructor(private readonly chunks: readonly string[]) {}

  async *streamReply(_input: ModelInput): AsyncIterable<string> {
    yield* this.chunks;
  }
}
