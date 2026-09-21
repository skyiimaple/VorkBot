import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ["@vork/contracts"] } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { output: { format: "cjs" } } } },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [tailwindcss()]
  }
});
