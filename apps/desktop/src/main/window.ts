import { BrowserWindow, type BrowserWindowConstructorOptions, shell } from "electron";
import { join } from "node:path";

/** Align with Grok Bot: traffic lights sit in the sidebar header row. */
const MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 15 } as const;

export function buildWindowOptions(): BrowserWindowConstructorOptions {
  const isMac = process.platform === "darwin";
  return {
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#fcfcfc",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

function openTrustedExternalUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol === "https:") void shell.openExternal(url.toString());
}

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(buildWindowOptions());
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      openTrustedExternalUrl(url);
    } catch {
      // Invalid URLs are denied with no external side effect.
    }
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
