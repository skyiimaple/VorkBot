import { app, BrowserWindow, ipcMain } from "electron";
import { registerApiIpc } from "./api.js";
import { createMainWindow } from "./window.js";

app.whenReady().then(() => {
  registerApiIpc(ipcMain);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
