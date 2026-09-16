import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { trace: "retain-on-failure" }
});
