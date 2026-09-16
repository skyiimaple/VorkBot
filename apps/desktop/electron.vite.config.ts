import { defineConfig } from "electron-vite";

export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ["@vork/contracts"] } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { output: { format: "cjs" } } } },
  renderer: {}
});
