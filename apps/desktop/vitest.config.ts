import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/renderer/src/test/setup.ts"]
  }
});
