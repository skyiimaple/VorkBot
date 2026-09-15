import type { VorkApi } from "../../preload/api.js";

declare global {
  interface Window {
    vorkApi: VorkApi;
  }
}

export {};
