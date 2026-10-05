import { describe, expect, it } from "vitest";
import { resolveSdkModelConfig } from "./create-sdk-runtime.js";

describe("resolveSdkModelConfig", () => {
  it("uses saved user settings ahead of environment defaults", () => {
    expect(resolveSdkModelConfig({ LLM_API_KEY: "env-key", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL: "env-model" }, { apiKey: "saved-key", baseUrl: "https://models.test/v1", model: "saved-model" })).toMatchObject({ apiKey: "saved-key", baseURL: "https://models.test/v1", model: "saved-model" });
  });
  it("uses DeepSeek defaults with the existing LLM key", () => {
    expect(resolveSdkModelConfig({ LLM_API_KEY: "deepseek-key" })).toMatchObject({ baseURL: "https://api.deepseek.com/v1", model: "deepseek-v4-flash" });
  });
  it("does not fall back to an OpenAI key and respects explicit FakeModel", () => {
    expect(resolveSdkModelConfig({ OPENAI_API_KEY: "openai-key" })).toBeUndefined();
    expect(resolveSdkModelConfig({ LLM_API_KEY: "deepseek-key", VORK_MODEL_PROVIDER: "fake" })).toBeUndefined();
  });
});
