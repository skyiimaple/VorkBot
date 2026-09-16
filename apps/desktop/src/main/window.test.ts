import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserWindow, shell } = vi.hoisted(() => ({
  browserWindow: vi.fn(),
  shell: { openExternal: vi.fn() }
}));

vi.mock("electron", () => ({
  BrowserWindow: browserWindow,
  shell
}));

import { buildWindowOptions, createMainWindow } from "./window.js";

describe("createMainWindow", () => {
  beforeEach(() => {
    browserWindow.mockReset();
    shell.openExternal.mockReset();
  });

  it("creates an isolated renderer without Node integration", () => {
    const options = buildWindowOptions();

    expect(options.webPreferences?.preload).toMatch(/preload\/index\.cjs$/);
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
  });

  it("blocks renderer navigation and only delegates secure external links", () => {
    const contents = new EventEmitter() as EventEmitter & {
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
    };
    contents.setWindowOpenHandler = vi.fn();
    const window = { webContents: contents, loadURL: vi.fn(), loadFile: vi.fn(), once: vi.fn(), show: vi.fn() };
    browserWindow.mockReturnValue(window);

    createMainWindow();
    const navigation = { preventDefault: vi.fn() };
    contents.emit("will-navigate", navigation, "https://attacker.example");
    const handler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string };

    expect(navigation.preventDefault).toHaveBeenCalledOnce();
    expect(handler({ url: "https://vork.example/docs" })).toEqual({ action: "deny" });
    expect(shell.openExternal).toHaveBeenCalledWith("https://vork.example/docs");
    expect(handler({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });
});
