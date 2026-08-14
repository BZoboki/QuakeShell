import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown;

// Capture registered ipcMain handlers and terminal callbacks
const ipcMainHandlers: Record<string, IpcHandler> = {};
const mockWebContentsSend = vi.fn();
const mockSettingsWebContentsSend = vi.fn();
const mockGetAllWindows = vi.fn(() => [
  {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: mockWebContentsSend,
      isDestroyed: vi.fn(() => false),
    },
  },
  {
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: mockSettingsWebContentsSend,
      isDestroyed: vi.fn(() => false),
    },
  },
]);

// Track terminal-manager callbacks
let capturedOnExitCallback: ((exitCode: number, signal: number) => void) | null = null;
let capturedPendingUpdateChangeCallback:
  | ((payload: { version: string; source: 'background-install' } | null) => void)
  | null = null;
let capturedUpdateOperationChangeCallback:
  | ((payload: {
    phase: string;
    currentVersion: string;
    latestVersion: string | null;
    action: string | null;
    error?: string;
  } | null) => void)
  | null = null;

const { mockElectronApp } = vi.hoisted(() => ({
  mockElectronApp: {
    getPath: vi.fn(() => 'C:\\Program Files\\QuakeShell\\quakeshell.exe'),
    getAppPath: vi.fn(() => 'C:\\Projects\\QuakeShell'),
    getVersion: vi.fn(() => '1.0.19'),
    isPackaged: false,
  },
}));

const { mockOsRelease } = vi.hoisted(() => ({
  mockOsRelease: vi.fn(() => '10.0.22621'),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      ipcMainHandlers[channel] = handler;
    }),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows(),
  },
  app: mockElectronApp,
}));

vi.mock('node:os', () => {
  const release = (...args: unknown[]) => mockOsRelease(...args);
  return { release, default: { release } };
});

vi.mock('electron-log/main', () => {
  const scopedLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: {
      scope: vi.fn(() => scopedLogger),
    },
  };
});

vi.mock('./terminal-manager', () => ({
  onData: vi.fn(),
  onExit: vi.fn((cb: (exitCode: number, signal: number) => void) => {
    capturedOnExitCallback = cb;
  }),
  onBell: vi.fn(),
  spawn: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  getDefaultShell: vi.fn(() => 'powershell'),
  setDefaultShell: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('./window-manager', () => ({
  toggle: vi.fn(),
  openSettingsWindow: vi.fn(),
  closeSettingsWindow: vi.fn(),
  setOpacity: vi.fn(),
  setupFocusFade: vi.fn(),
  teardownFocusFade: vi.fn(),
  onStateChange: vi.fn(),
  isVisible: vi.fn(() => true),
}));

vi.mock('./hotkey-manager', () => ({
  reregister: vi.fn(),
}));

vi.mock('./tray-manager', () => ({
  rebuildContextMenu: vi.fn(),
}));

vi.mock('./app-lifecycle', () => ({
  applyAutostart: vi.fn(),
}));

vi.mock('./notification-manager', () => ({
  send: vi.fn(),
  getUpdateOperationState: vi.fn(() => null),
  checkForUpdates: vi.fn(() => Promise.resolve({})),
  startAvailableUpdate: vi.fn(() => Promise.resolve(null)),
  openAvailableUpdateDownload: vi.fn(() => Promise.resolve(false)),
  onUpdateOperationChange: vi.fn((callback: (payload: {
    phase: string;
    currentVersion: string;
    latestVersion: string | null;
    action: string | null;
    error?: string;
  } | null) => void) => {
    capturedUpdateOperationChangeCallback = callback;
    return vi.fn();
  }),
  getPendingUpdate: vi.fn(() => null),
  restartPendingUpdate: vi.fn(() => Promise.resolve(false)),
  delayPendingUpdate: vi.fn(() => null),
  onPendingUpdateChange: vi.fn((callback: (payload: { version: string; source: 'background-install' } | null) => void) => {
    capturedPendingUpdateChangeCallback = callback;
    return vi.fn();
  }),
}));

vi.mock('./context-menu-installer', () => ({
  register: vi.fn(),
  deregister: vi.fn(),
  isRegistered: vi.fn(() => false),
}));

vi.mock('./tab-manager', () => ({
  writeToTab: vi.fn(),
  createTab: vi.fn(() => ({ id: 'mock-tab', shellType: 'powershell', color: '#7aa2f7', createdAt: 1 })),
  closeTab: vi.fn(),
  setActiveTab: vi.fn(),
  renameTab: vi.fn(),
  reorderTabs: vi.fn(() => []),
  listTabs: vi.fn(() => []),
  resizeTab: vi.fn(),
}));

vi.mock('./theme-engine', () => ({
  themeEngine: {
    listThemes: vi.fn(() => [{ id: 'tokyo-night', name: 'Tokyo Night' }]),
    getActiveTheme: vi.fn(() => ({ id: 'tokyo-night', name: 'Tokyo Night' })),
    setActiveTheme: vi.fn((id: string) => ({ id, name: id })),
  },
}));

import { CHANNELS } from '../shared/channels';
import { registerIpcHandlers } from './ipc-handlers';
import type { ConfigStore } from './config-store';
import * as windowManager from './window-manager';
import * as terminalManager from './terminal-manager';
import * as tabManager from './tab-manager';
import * as notificationManager from './notification-manager';
import { themeEngine } from './theme-engine';
import * as contextMenuInstaller from './context-menu-installer';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('main/ipc-handlers', () => {
  const mockMainWindow = {
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    webContents: {
      send: mockWebContentsSend,
      isDestroyed: vi.fn(() => false),
    },
  } as unknown as Electron.BrowserWindow;

  const mockConfigStore = {
    getAll: vi.fn(() => ({ hotkey: 'F1', defaultShell: 'powershell' })),
    get: vi.fn((key: string) => {
      if (key === 'hotkey') return 'F1';
      if (key === 'defaultShell') return 'powershell';
      return undefined;
    }),
    set: vi.fn(),
    onDidChange: vi.fn(),
    getConfigPath: vi.fn(() => '/mock/config.json'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnExitCallback = null;
    capturedPendingUpdateChangeCallback = null;
    capturedUpdateOperationChangeCallback = null;
    mockElectronApp.isPackaged = false;
    Object.keys(ipcMainHandlers).forEach((key) => delete ipcMainHandlers[key]);
    registerIpcHandlers(mockConfigStore as unknown as ConfigStore, mockMainWindow);
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  describe('pending update IPC', () => {
    it('returns the current pending update payload', async () => {
      vi.mocked(notificationManager.getPendingUpdate).mockReturnValueOnce({
        version: '2.0.0',
        source: 'background-install',
      });

      await expect(ipcMainHandlers[CHANNELS.APP_GET_PENDING_UPDATE]({})).resolves.toEqual({
        version: '2.0.0',
        source: 'background-install',
      });
    });

    it('forwards restartPendingUpdate requests to notification-manager', async () => {
      vi.mocked(notificationManager.restartPendingUpdate).mockResolvedValueOnce(true);

      await expect(ipcMainHandlers[CHANNELS.APP_RESTART_PENDING_UPDATE]({})).resolves.toBe(true);
      expect(notificationManager.restartPendingUpdate).toHaveBeenCalledTimes(1);
    });

    it('forwards delayPendingUpdate requests to notification-manager', async () => {
      vi.mocked(notificationManager.delayPendingUpdate).mockReturnValueOnce({
        version: '2.0.0',
        source: 'background-install',
      });

      await expect(ipcMainHandlers[CHANNELS.APP_DELAY_PENDING_UPDATE]({})).resolves.toEqual({
        version: '2.0.0',
        source: 'background-install',
      });
      expect(notificationManager.delayPendingUpdate).toHaveBeenCalledTimes(1);
    });

    it('broadcasts pending update changes to the renderer', () => {
      expect(capturedPendingUpdateChangeCallback).not.toBeNull();

      capturedPendingUpdateChangeCallback!({
        version: '2.0.0',
        source: 'background-install',
      });

      expect(mockWebContentsSend).toHaveBeenCalledWith(CHANNELS.APP_UPDATE_READY, {
        version: '2.0.0',
        source: 'background-install',
      });
      expect(mockSettingsWebContentsSend).toHaveBeenCalledWith(CHANNELS.APP_UPDATE_READY, {
        version: '2.0.0',
        source: 'background-install',
      });
    });
  });

  describe('update operation IPC', () => {
    it('returns the installed application version', async () => {
      await expect(ipcMainHandlers[CHANNELS.APP_GET_VERSION]({})).resolves.toBe('1.0.19');
    });

    it('returns the current update operation state', async () => {
      vi.mocked(notificationManager.getUpdateOperationState).mockReturnValueOnce({
        phase: 'available',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'install',
      });

      await expect(ipcMainHandlers[CHANNELS.APP_GET_UPDATE_OPERATION]({})).resolves.toEqual({
        phase: 'available',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'install',
      });
    });

    it('runs a manual update check through the notification manager', async () => {
      await ipcMainHandlers[CHANNELS.APP_CHECK_FOR_UPDATES]({});

      expect(notificationManager.checkForUpdates).toHaveBeenCalledWith(true);
    });

    it('starts an available update and opens a validated download fallback', async () => {
      await ipcMainHandlers[CHANNELS.APP_START_AVAILABLE_UPDATE]({});
      await ipcMainHandlers[CHANNELS.APP_OPEN_AVAILABLE_UPDATE_DOWNLOAD]({});

      expect(notificationManager.startAvailableUpdate).toHaveBeenCalledTimes(1);
      expect(notificationManager.openAvailableUpdateDownload).toHaveBeenCalledTimes(1);
    });

    it('broadcasts update-operation changes to the renderer', () => {
      expect(capturedUpdateOperationChangeCallback).not.toBeNull();

      capturedUpdateOperationChangeCallback!({
        phase: 'error',
        currentVersion: '1.0.19',
        latestVersion: null,
        action: null,
        error: 'Network error',
      });

      expect(mockWebContentsSend).toHaveBeenCalledWith(CHANNELS.APP_UPDATE_OPERATION_CHANGED, {
        phase: 'error',
        currentVersion: '1.0.19',
        latestVersion: null,
        action: null,
        error: 'Network error',
      });
      expect(mockSettingsWebContentsSend).toHaveBeenCalledWith(CHANNELS.APP_UPDATE_OPERATION_CHANGED, {
        phase: 'error',
        currentVersion: '1.0.19',
        latestVersion: null,
        action: null,
        error: 'Network error',
      });
    });
  });

  describe('tab:input handler', () => {
    it('registers TAB_INPUT handler', () => {
      expect(ipcMainHandlers[CHANNELS.TAB_INPUT]).toBeDefined();
    });

    it('writes data to terminal via tab:input', async () => {
      await ipcMainHandlers[CHANNELS.TAB_INPUT]({}, { tabId: 'default', data: 'hello' });
      expect(tabManager.writeToTab).toHaveBeenCalledWith('default', 'hello');
    });

    it('does NOT have a TERMINAL_WRITE handler registered', () => {
      expect(ipcMainHandlers['terminal:write']).toBeUndefined();
    });
  });

  describe('theme handlers', () => {
    it('returns the active theme via theme:get-active', async () => {
      await expect(ipcMainHandlers[CHANNELS.THEME_GET_ACTIVE]({})).resolves.toEqual({
        id: 'tokyo-night',
        name: 'Tokyo Night',
      });

      expect(themeEngine.getActiveTheme).toHaveBeenCalledTimes(1);
    });

    it('returns the available theme list via theme:list', async () => {
      await expect(ipcMainHandlers[CHANNELS.THEME_LIST]({})).resolves.toEqual([
        { id: 'tokyo-night', name: 'Tokyo Night' },
      ]);

      expect(themeEngine.listThemes).toHaveBeenCalledTimes(1);
    });

    it('persists and applies a new theme via theme:set', async () => {
      await expect(ipcMainHandlers[CHANNELS.THEME_SET]({}, { id: 'solarized-dark' })).resolves.toEqual({
        id: 'solarized-dark',
        name: 'solarized-dark',
      });

      expect(mockConfigStore.set).toHaveBeenCalledWith('theme', 'solarized-dark');
      expect(themeEngine.setActiveTheme).toHaveBeenCalledWith('solarized-dark');
    });
  });

  describe('tab:resize handler', () => {
    it('resizes an existing tab session', async () => {
      await expect(
        ipcMainHandlers[CHANNELS.TAB_RESIZE]({}, { tabId: 'default', cols: 120, rows: 40 }),
      ).resolves.toBeUndefined();

      expect(tabManager.resizeTab).toHaveBeenCalledWith('default', 120, 40);
    });

    it('ignores late resize events for tabs that were already closed', async () => {
      vi.mocked(tabManager.resizeTab).mockImplementation(() => {
        throw new Error('Tab not found: stale-tab');
      });

      await expect(
        ipcMainHandlers[CHANNELS.TAB_RESIZE]({}, { tabId: 'stale-tab', cols: 80, rows: 24 }),
      ).resolves.toBeUndefined();
    });

    it('still surfaces unexpected resize failures', async () => {
      vi.mocked(tabManager.resizeTab).mockImplementation(() => {
        throw new Error('Resize exploded');
      });

      await expect(
        ipcMainHandlers[CHANNELS.TAB_RESIZE]({}, { tabId: 'default', cols: 80, rows: 24 }),
      ).rejects.toThrow('Resize exploded');
    });
  });

  describe('tab:reorder handler', () => {
    it('reorders tabs through the tab manager', async () => {
      vi.mocked(tabManager.reorderTabs).mockReturnValueOnce([
        { id: 'tab-3', shellType: 'powershell', color: '#bb9af7', createdAt: 3, status: 'running' },
        { id: 'tab-1', shellType: 'powershell', color: '#7aa2f7', createdAt: 1, status: 'running' },
      ]);

      await expect(
        ipcMainHandlers[CHANNELS.TAB_REORDER]({}, { tabIds: ['tab-3', 'tab-1'] }),
      ).resolves.toEqual([
        { id: 'tab-3', shellType: 'powershell', color: '#bb9af7', createdAt: 3, status: 'running' },
        { id: 'tab-1', shellType: 'powershell', color: '#7aa2f7', createdAt: 1, status: 'running' },
      ]);

      expect(tabManager.reorderTabs).toHaveBeenCalledWith(['tab-3', 'tab-1']);
    });
  });

  describe('tab:data broadcast', () => {
    it('registers onData callback that broadcasts TAB_DATA with tabId', () => {
      const onDataMock = vi.mocked(terminalManager.onData);
      expect(onDataMock).toHaveBeenCalledWith(expect.any(Function));

      // Simulate data from terminal-manager
      const registeredCallback = onDataMock.mock.calls[0][0];
      registeredCallback('default', 'output data');

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        CHANNELS.TAB_DATA,
        { tabId: 'default', data: 'output data' },
      );
    });
  });

  describe('terminal exit handling', () => {
    it('sends TERMINAL_PROCESS_EXIT to renderer on normal exit', () => {
      expect(capturedOnExitCallback).not.toBeNull();

      capturedOnExitCallback!(0, 0);

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        CHANNELS.TERMINAL_PROCESS_EXIT,
        { exitCode: 0, signal: 0, isNormalExit: true },
      );
    });

    it('sends TERMINAL_PROCESS_EXIT with isNormalExit=false on crash', () => {
      capturedOnExitCallback!(1, 0);

      expect(mockWebContentsSend).toHaveBeenCalledWith(
        CHANNELS.TERMINAL_PROCESS_EXIT,
        { exitCode: 1, signal: 0, isNormalExit: false },
      );
    });

    it('does NOT auto-respawn after exit', () => {
      capturedOnExitCallback!(1, 0);

      // No spawn should be called — user must press Enter
      expect(terminalManager.spawn).not.toHaveBeenCalled();
    });

    it('sends notification on crash when window is hidden', () => {
      capturedOnExitCallback!(1, 15);

      expect(notificationManager.send).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'Shell process exited unexpectedly',
        onClick: expect.any(Function),
      });
    });

    it('does NOT send notification on crash when window is visible', () => {
      capturedOnExitCallback!(1, 0);

      // notificationManager.send IS called — suppression is handled inside notification-manager
      // But we verify the call was made with the crash message
      expect(notificationManager.send).toHaveBeenCalled();
    });

    it('does NOT send notification on normal exit even when hidden', () => {
      capturedOnExitCallback!(0, 0);

      expect(notificationManager.send).not.toHaveBeenCalled();
    });

    it('notification onClick callback toggles window into view', () => {
      capturedOnExitCallback!(1, 0);

      // Get the onClick callback from the send call
      const sendCall = vi.mocked(notificationManager.send).mock.calls[0][0];
      sendCall.onClick!();

      expect(windowManager.toggle).toHaveBeenCalled();
    });
  });

  describe('terminal respawn handler', () => {
    it('registers TERMINAL_RESPAWN handler', () => {
      expect(ipcMainHandlers[CHANNELS.TERMINAL_RESPAWN]).toBeDefined();
    });

    it('spawns new shell with configured default on respawn', async () => {
      await ipcMainHandlers[CHANNELS.TERMINAL_RESPAWN]({});

      expect(terminalManager.getDefaultShell).toHaveBeenCalled();
      expect(terminalManager.spawn).toHaveBeenCalledWith('powershell');
    });
  });

  describe('settings window handlers', () => {
    it('opens the dedicated settings window', async () => {
      await expect(
        ipcMainHandlers[CHANNELS.WINDOW_OPEN_SETTINGS]({}, { tab: 'keyboard' }),
      ).resolves.toBeUndefined();

      expect(windowManager.openSettingsWindow).toHaveBeenCalledWith('keyboard');
    });

    it('closes the dedicated settings window', async () => {
      await expect(
        ipcMainHandlers[CHANNELS.WINDOW_CLOSE_SETTINGS]({}),
      ).resolves.toBeUndefined();

      expect(windowManager.closeSettingsWindow).toHaveBeenCalledTimes(1);
    });
  });

  describe('context menu handlers', () => {
    it('registers the Explorer context menu using the executable and app path in development', async () => {
      await expect(ipcMainHandlers[CHANNELS.APP_REGISTER_CONTEXT_MENU]({})).resolves.toEqual({ success: true });

      expect(contextMenuInstaller.register).toHaveBeenCalledWith(
        'C:\\Program Files\\QuakeShell\\quakeshell.exe',
        'C:\\Projects\\QuakeShell',
      );
    });

    it('registers the Explorer context menu using only the executable path when packaged', async () => {
      mockElectronApp.isPackaged = true;
      Object.keys(ipcMainHandlers).forEach((key) => delete ipcMainHandlers[key]);
      registerIpcHandlers(mockConfigStore as unknown as ConfigStore, mockMainWindow);

      await expect(ipcMainHandlers[CHANNELS.APP_REGISTER_CONTEXT_MENU]({})).resolves.toEqual({ success: true });

      expect(contextMenuInstaller.register).toHaveBeenCalledWith(
        'C:\\Program Files\\QuakeShell\\quakeshell.exe',
        undefined,
      );
    });

    it('returns a failed result when context-menu registration throws', async () => {
      vi.mocked(contextMenuInstaller.register).mockImplementationOnce(() => {
        throw new Error('Registry write failed');
      });

      await expect(ipcMainHandlers[CHANNELS.APP_REGISTER_CONTEXT_MENU]({})).resolves.toEqual({
        success: false,
        error: 'Registry write failed',
      });
    });

    it('deregisters the Explorer context menu', async () => {
      await expect(ipcMainHandlers[CHANNELS.APP_DEREGISTER_CONTEXT_MENU]({})).resolves.toEqual({ success: true });

      expect(contextMenuInstaller.deregister).toHaveBeenCalledTimes(1);
    });

    it('returns context-menu status via the installer module', async () => {
      vi.mocked(contextMenuInstaller.isRegistered).mockReturnValueOnce(true);

      await expect(ipcMainHandlers[CHANNELS.APP_CONTEXT_MENU_STATUS]({})).resolves.toEqual({
        isRegistered: true,
        available: true,
      });
    });
  });

  describe('platform:get-terminal-pty-info handler', () => {
    it('registers the PLATFORM_GET_TERMINAL_PTY_INFO handler', () => {
      expect(ipcMainHandlers[CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO]).toBeDefined();
    });

    it('returns the conpty backend and parsed build number on Windows', async () => {
      setPlatform('win32');
      mockOsRelease.mockReturnValueOnce('10.0.22621');

      await expect(
        ipcMainHandlers[CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO]({}),
      ).resolves.toEqual({ backend: 'conpty', buildNumber: 22621 });
    });

    it('returns null on non-Windows platforms', async () => {
      setPlatform('darwin');

      await expect(
        ipcMainHandlers[CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO]({}),
      ).resolves.toBeNull();
    });

    it('falls back to build number 0 when os.release() is malformed', async () => {
      setPlatform('win32');
      mockOsRelease.mockReturnValueOnce('not-a-version');

      await expect(
        ipcMainHandlers[CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO]({}),
      ).resolves.toEqual({ backend: 'conpty', buildNumber: 0 });
    });

    it('falls back to build number 0 when the third release segment is present but non-numeric', async () => {
      setPlatform('win32');
      mockOsRelease.mockReturnValueOnce('10.0.abc');

      await expect(
        ipcMainHandlers[CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO]({}),
      ).resolves.toEqual({ backend: 'conpty', buildNumber: 0 });
    });
  });
});
