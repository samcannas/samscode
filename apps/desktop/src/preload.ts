import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@samscode/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const WINDOW_MINIMIZE_CHANNEL = "desktop:window-minimize";
const WINDOW_MAXIMIZE_CHANNEL = "desktop:window-maximize";
const WINDOW_CLOSE_CHANNEL = "desktop:window-close";
const WINDOW_IS_MAXIMIZED_CHANNEL = "desktop:window-is-maximized";
const WINDOW_MAXIMIZED_CHANGE_CHANNEL = "desktop:window-maximized-change";
const wsUrl = process.env.SAMSCODE_DESKTOP_WS_URL ?? null;

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => wsUrl,
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdates: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  windowMinimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE_CHANNEL),
  windowMaximize: () => ipcRenderer.invoke(WINDOW_MAXIMIZE_CHANNEL),
  windowClose: () => ipcRenderer.invoke(WINDOW_CLOSE_CHANNEL),
  getWindowIsMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED_CHANNEL),
  onWindowMaximizedChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, isMaximized: unknown) => {
      if (typeof isMaximized !== "boolean") return;
      listener(isMaximized);
    };

    ipcRenderer.on(WINDOW_MAXIMIZED_CHANGE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
