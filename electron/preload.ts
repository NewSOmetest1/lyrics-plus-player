import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ElectronAPI } from "./api";

const api: ElectronAPI = {
  isElectron: true,
  invoke: <T>(channel: string, payload?: unknown) =>
    ipcRenderer.invoke(channel, payload) as Promise<T>,
  on: <T>(channel: string, listener: (payload: T) => void) => {
    const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  selectFolder: () => ipcRenderer.invoke("dialog:select_folder") as Promise<string | null>,
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke("window:toggle_maximize") as Promise<void>,
    close: () => ipcRenderer.invoke("window:close") as Promise<void>,
    isMaximized: () => ipcRenderer.invoke("window:is_maximized") as Promise<boolean>,
    onMaximized: (listener: (maximized: boolean) => void) => {
      const wrapped = (_event: IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on("window:maximized", wrapped);
      return () => {
        ipcRenderer.removeListener("window:maximized", wrapped);
      };
    },
    resizeStart: (direction: string) =>
      ipcRenderer.invoke("window:resize_start", direction) as Promise<void>,
    resizeEnd: () => ipcRenderer.invoke("window:resize_end") as Promise<void>,
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
