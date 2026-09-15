import { contextBridge, ipcRenderer } from "electron";
import { createVorkApi } from "./api.js";

contextBridge.exposeInMainWorld("vorkApi", createVorkApi(ipcRenderer));
