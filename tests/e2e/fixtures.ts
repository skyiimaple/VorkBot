import { _electron, expect, test as base, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/desktop");
const electronBinary = createRequire(join(desktopRoot, "package.json"))("electron") as string;
let sharedDataDirectory: string | undefined;

export async function launchVork(): Promise<ElectronApplication> {
  if (!sharedDataDirectory) throw new Error("Vork E2E data directory is not initialized");
  return _electron.launch({
    executablePath: electronBinary,
    args: [join(desktopRoot, "out/main/index.js")],
    env: { ...process.env, VORK_USER_DATA_DIR: sharedDataDirectory, VORK_API_BASE_URL: "http://127.0.0.1:3000" }
  });
}

export const test = base.extend<{ electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    sharedDataDirectory = await mkdtemp(join(tmpdir(), "vork-e2e-"));
    const electronApp = await launchVork();
    try {
      await use(electronApp);
    } finally {
      await electronApp.close().catch(() => {});
      await rm(sharedDataDirectory, { recursive: true, force: true });
      sharedDataDirectory = undefined;
    }
  }
});

export { expect };
