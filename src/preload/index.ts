import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '@shared/channels';
import type {
  PendingUpdatePayload,
  TabDataPayload,
  TabExitedPayload,
  UpdateOperationState,
} from '@shared/ipc-types';

type IpcSubscriber<TArgs extends unknown[]> = (...args: TArgs) => void;

function createIpcSubscriber<TArgs extends unknown[]>(channel: string) {
  const subscribers = new Set<IpcSubscriber<TArgs>>();
  let listening = false;

  const listener = (_event: Electron.IpcRendererEvent, ...args: TArgs) => {
    for (const subscriber of [...subscribers]) {
      subscriber(...args);
    }
  };

  return (callback: IpcSubscriber<TArgs>) => {
    const subscription: IpcSubscriber<TArgs> = (...args) => callback(...args);
    subscribers.add(subscription);

    if (!listening) {
      ipcRenderer.on(channel, listener);
      listening = true;
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return;

      subscribed = false;
      subscribers.delete(subscription);

      if (subscribers.size === 0 && listening) {
        ipcRenderer.removeListener(channel, listener);
        listening = false;
      }
    };
  };
}

const subscribeToTerminalFocus = createIpcSubscriber<[]>(CHANNELS.TERMINAL_FOCUS);
const subscribeToTabData = createIpcSubscriber<[TabDataPayload]>(CHANNELS.TAB_DATA);
const subscribeToTabExited = createIpcSubscriber<[TabExitedPayload]>(CHANNELS.TAB_EXITED);
const subscribeToUpdateOperation = createIpcSubscriber<[UpdateOperationState | null]>(
  CHANNELS.APP_UPDATE_OPERATION_CHANGED,
);

contextBridge.exposeInMainWorld('quakeshell', {
  config: {
    getAll: () => ipcRenderer.invoke(CHANNELS.CONFIG_GET_ALL),
    get: (key: string) => ipcRenderer.invoke(CHANNELS.CONFIG_GET, key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke(CHANNELS.CONFIG_SET, { key, value }),
    openInEditor: () => ipcRenderer.invoke(CHANNELS.CONFIG_OPEN_FILE),
    onConfigChange: (callback: (payload: { key: string; value: unknown; oldValue: unknown }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { key: string; value: unknown; oldValue: unknown },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.CONFIG_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.CONFIG_CHANGED, listener);
      };
    },
  },
  theme: {
    list: () => ipcRenderer.invoke(CHANNELS.THEME_LIST),
    getActive: () => ipcRenderer.invoke(CHANNELS.THEME_GET_ACTIVE),
    getCurrent: () => ipcRenderer.invoke(CHANNELS.THEME_GET_CURRENT),
    set: (id: string) => ipcRenderer.invoke(CHANNELS.THEME_SET, { id }),
    onChanged: (callback: (theme: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => callback(theme);
      ipcRenderer.on(CHANNELS.THEME_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.THEME_CHANGED, listener);
      };
    },
  },
  terminal: {
    spawn: (cols: number, rows: number) =>
      ipcRenderer.invoke(CHANNELS.TERMINAL_SPAWN, { cols, rows }),
    resize: (cols: number, rows: number) =>
      ipcRenderer.invoke(CHANNELS.TERMINAL_RESIZE, { cols, rows }),
    onProcessExit: (callback: (payload: { exitCode: number; signal: number; isNormalExit: boolean }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { exitCode: number; signal: number; isNormalExit: boolean },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.TERMINAL_PROCESS_EXIT, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.TERMINAL_PROCESS_EXIT, listener);
      };
    },
    respawnShell: () => ipcRenderer.invoke(CHANNELS.TERMINAL_RESPAWN),
    onFocus: (callback: () => void) => subscribeToTerminalFocus(callback),
  },
  tab: {
    create: (options?: { shellType?: string; cwd?: string; deferred?: boolean }) =>
      ipcRenderer.invoke(CHANNELS.TAB_CREATE, options),
    createSplit: (primaryTabId: string, cwd?: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_CREATE_SPLIT, { primaryTabId, cwd }),
    spawnTab: (tabId: string, shellType: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_SPAWN, { tabId, shellType }),
    availableShells: () =>
      ipcRenderer.invoke(CHANNELS.TAB_AVAILABLE_SHELLS),
    close: (tabId: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_CLOSE, { tabId }),
    switchTo: (tabId: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_SWITCH, { tabId }),
    rename: (tabId: string, name: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_RENAME, { tabId, name }),
    reorder: (tabIds: string[]) =>
      ipcRenderer.invoke(CHANNELS.TAB_REORDER, { tabIds }),
    list: () =>
      ipcRenderer.invoke(CHANNELS.TAB_LIST),
    input: (tabId: string, data: string) =>
      ipcRenderer.invoke(CHANNELS.TAB_INPUT, { tabId, data }),
    resize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(CHANNELS.TAB_RESIZE, { tabId, cols, rows }),
    onData: (callback: (payload: TabDataPayload) => void) => subscribeToTabData(callback),
    onClosed: (callback: (payload: { tabId: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.TAB_CLOSED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.TAB_CLOSED, listener);
      };
    },
    onActiveChanged: (callback: (payload: { tabId: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.TAB_ACTIVE_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.TAB_ACTIVE_CHANGED, listener);
      };
    },
    onExited: (callback: (payload: TabExitedPayload) => void) => subscribeToTabExited(callback),
    onRenamed: (callback: (payload: { tabId: string; name: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string; name: string },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.TAB_RENAMED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.TAB_RENAMED, listener);
      };
    },
    onAutoName: (callback: (payload: { tabId: string; name: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string; name: string },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.TAB_AUTO_NAME, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.TAB_AUTO_NAME, listener);
      };
    },
  },
  window: {
    toggle: () => ipcRenderer.invoke(CHANNELS.WINDOW_TOGGLE),
    openSettings: (tab?: string) => ipcRenderer.invoke(CHANNELS.WINDOW_OPEN_SETTINGS, { tab }),
    closeSettings: () => ipcRenderer.invoke(CHANNELS.WINDOW_CLOSE_SETTINGS),
    resizeStart: () =>
      ipcRenderer.invoke(CHANNELS.WINDOW_RESIZE),
    resizeEnd: (persist: boolean) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_RESIZE_END, { persist }),
    resetHeight: () =>
      ipcRenderer.invoke(CHANNELS.WINDOW_RESIZE_RESET),
    onStateChanged: (callback: (payload: { visible: boolean }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { visible: boolean },
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.WINDOW_STATE_CHANGED, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.WINDOW_STATE_CHANGED, listener);
      };
    },
    setReducedMotion: (value: boolean) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_SET_REDUCED_MOTION, { value }),
    setAcrylicBlur: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.WINDOW_SET_ACRYLIC_BLUR, { enabled }),
  },
  app: {
    checkWSL: () => ipcRenderer.invoke(CHANNELS.APP_CHECK_WSL),
    getVersion: () => ipcRenderer.invoke(CHANNELS.APP_GET_VERSION),
    getUpdateOperation: () => ipcRenderer.invoke(CHANNELS.APP_GET_UPDATE_OPERATION),
    checkForUpdates: () => ipcRenderer.invoke(CHANNELS.APP_CHECK_FOR_UPDATES),
    startAvailableUpdate: () => ipcRenderer.invoke(CHANNELS.APP_START_AVAILABLE_UPDATE),
    openAvailableUpdateDownload: () => ipcRenderer.invoke(CHANNELS.APP_OPEN_AVAILABLE_UPDATE_DOWNLOAD),
    onUpdateOperationChanged: (callback: (state: UpdateOperationState | null) => void) =>
      subscribeToUpdateOperation(callback),
    getPendingUpdate: () => ipcRenderer.invoke(CHANNELS.APP_GET_PENDING_UPDATE),
    restartPendingUpdate: () => ipcRenderer.invoke(CHANNELS.APP_RESTART_PENDING_UPDATE),
    delayPendingUpdate: () => ipcRenderer.invoke(CHANNELS.APP_DELAY_PENDING_UPDATE),
    onUpdateReady: (callback: (payload: PendingUpdatePayload | null) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: PendingUpdatePayload | null,
      ) => callback(payload);
      ipcRenderer.on(CHANNELS.APP_UPDATE_READY, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.APP_UPDATE_READY, listener);
      };
    },
    registerContextMenu: () => ipcRenderer.invoke(CHANNELS.APP_REGISTER_CONTEXT_MENU),
    deregisterContextMenu: () => ipcRenderer.invoke(CHANNELS.APP_DEREGISTER_CONTEXT_MENU),
    getContextMenuStatus: () => ipcRenderer.invoke(CHANNELS.APP_CONTEXT_MENU_STATUS),
  },
  platform: {
    isAcrylicSupported: () => ipcRenderer.invoke(CHANNELS.PLATFORM_IS_ACRYLIC_SUPPORTED),
    getTerminalPtyInfo: () => ipcRenderer.invoke(CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO),
  },
  display: {
    getAll: () => ipcRenderer.invoke(CHANNELS.DISPLAY_GET_ALL),
  },
  hotkey: {
    reregister: (newHotkey: string) => ipcRenderer.invoke(CHANNELS.HOTKEY_REREGISTER, { newHotkey }),
  },
});
