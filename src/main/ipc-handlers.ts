import { ipcMain, BrowserWindow, shell, screen, app } from 'electron';
import { execSync } from 'node:child_process';
import os from 'node:os';
import log from 'electron-log/main';
import { CHANNELS } from '@shared/channels';
import type { TerminalProcessExitPayload } from '@shared/ipc-types';
import { type ConfigStore } from './config-store';
import * as terminalManager from './terminal-manager';
import * as tabManager from './tab-manager';
import * as windowManager from './window-manager';
import * as hotkeyManager from './hotkey-manager';
import * as trayManager from './tray-manager';
import * as notificationManager from './notification-manager';
import { applyAutostart } from './app-lifecycle';
import {
  register as registerContextMenu,
  deregister as deregisterContextMenu,
  isRegistered as isContextMenuRegistered,
} from './context-menu-installer';
import { themeEngine } from './theme-engine';

const logger = log.scope('ipc');

function getContextMenuAppPath(): string | undefined {
  if (app.isPackaged) {
    return undefined;
  }

  const appPath = app.getAppPath();
  if (!appPath || appPath === app.getPath('exe')) {
    return undefined;
  }

  return appPath;
}

function getValueAtPath(source: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);
}

function setValueAtPath(source: unknown, pathSegments: string[], value: unknown): unknown {
  if (pathSegments.length === 0) {
    return value;
  }

  const [segment, ...rest] = pathSegments;
  const record = source && typeof source === 'object'
    ? { ...(source as Record<string, unknown>) }
    : {};

  record[segment] = setValueAtPath(record[segment], rest, value);
  return record;
}

function getConfigValue(configStore: ConfigStore, keyPath: string): unknown {
  if (!keyPath.includes('.')) {
    return configStore.get(keyPath as keyof ReturnType<ConfigStore['getAll']>);
  }

  return getValueAtPath(configStore.getAll(), keyPath);
}

function setConfigValue(configStore: ConfigStore, keyPath: string, value: unknown): unknown {
  if (!keyPath.includes('.')) {
    configStore.set(keyPath as keyof ReturnType<ConfigStore['getAll']>, value as never);
    return configStore.get(keyPath as keyof ReturnType<ConfigStore['getAll']>);
  }

  const [rootKey, ...rest] = keyPath.split('.');
  const currentRootValue = configStore.get(rootKey as keyof ReturnType<ConfigStore['getAll']>);
  const nextRootValue = setValueAtPath(currentRootValue, rest, value);

  configStore.set(rootKey as keyof ReturnType<ConfigStore['getAll']>, nextRootValue as never);
  return getValueAtPath(configStore.getAll(), keyPath);
}

export function broadcastConfigChange(
  key: string,
  value: unknown,
  oldValue: unknown,
): void {
  const payload = { key, value, oldValue };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CHANNELS.CONFIG_CHANGED, payload);
  }
}

export function registerIpcHandlers(
  configStore: ConfigStore,
  mainWindow: BrowserWindow,
): void {
  ipcMain.handle(CHANNELS.CONFIG_GET_ALL, async () => {
    try {
      return configStore.getAll();
    } catch (error) {
      logger.error('config:get-all failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to get config',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.CONFIG_SET,
    async (_event, { key, value }: { key: string; value: unknown }) => {
      try {
        return setConfigValue(configStore, key, value);
      } catch (error) {
        logger.error(`config:set failed for key "${key}":`, error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to set config',
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.CONFIG_GET, async (_event, key: string) => {
    try {
      return getConfigValue(configStore, key);
    } catch (error) {
      logger.error(`config:get failed for key "${key}":`, error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to get config value',
      );
    }
  });

  ipcMain.handle(CHANNELS.CONFIG_OPEN_FILE, async () => {
    try {
      const configPath = configStore.getConfigPath();
      await shell.openPath(configPath);
    } catch (error) {
      logger.error('config:open-file failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to open config file',
      );
    }
  });

  ipcMain.handle(CHANNELS.THEME_LIST, async () => {
    try {
      return typeof themeEngine.listThemeInfo === 'function'
        ? themeEngine.listThemeInfo()
        : themeEngine.listThemes();
    } catch (error) {
      logger.error('theme:list failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to list themes',
      );
    }
  });

  ipcMain.handle(CHANNELS.THEME_GET_ACTIVE, async () => {
    try {
      return themeEngine.getActiveTheme();
    } catch (error) {
      logger.error('theme:get-active failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to get active theme',
      );
    }
  });

  ipcMain.handle(CHANNELS.THEME_GET_CURRENT, async () => {
    try {
      return themeEngine.getActiveTheme().id;
    } catch (error) {
      logger.error('theme:get-current failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to get current theme id',
      );
    }
  });

  ipcMain.handle(CHANNELS.THEME_SET, async (_event, { id }: { id: string }) => {
    try {
      configStore.set('theme', id);
      return themeEngine.setActiveTheme(id);
    } catch (error) {
      logger.error('theme:set failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to set theme',
      );
    }
  });

  // Terminal handlers
  ipcMain.handle(
    CHANNELS.TERMINAL_SPAWN,
    async (
      _event,
      { cols, rows }: { cols: number; rows: number },
    ) => {
      try {
        const shell = terminalManager.getDefaultShell();
        terminalManager.spawn(shell, cols, rows);
      } catch (error) {
        logger.error('terminal:spawn failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to spawn terminal',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_INPUT,
    async (_event, { tabId, data }: { tabId: string; data: string }) => {
      try {
        tabManager.writeToTab(tabId, data);
      } catch (error) {
        logger.error('tab:input failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to write to terminal',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_CREATE,
    async (_event, options?: { shellType?: string; cwd?: string }) => {
      try {
        return tabManager.createTab(options ?? {});
      } catch (error) {
        logger.error('tab:create failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to create tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_CLOSE,
    async (_event, { tabId }: { tabId: string }) => {
      try {
        tabManager.closeTab(tabId);
      } catch (error) {
        logger.error('tab:close failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to close tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_SWITCH,
    async (_event, { tabId }: { tabId: string }) => {
      try {
        tabManager.setActiveTab(tabId);
      } catch (error) {
        logger.error('tab:switch failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to switch tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_RENAME,
    async (_event, { tabId, name }: { tabId: string; name: string }) => {
      try {
        tabManager.renameTab(tabId, name);
      } catch (error) {
        logger.error('tab:rename failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to rename tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_REORDER,
    async (_event, { tabIds }: { tabIds: string[] }) => {
      try {
        return tabManager.reorderTabs(tabIds);
      } catch (error) {
        logger.error('tab:reorder failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to reorder tabs',
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.TAB_LIST, async () => {
    try {
      return tabManager.listTabs();
    } catch (error) {
      logger.error('tab:list failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to list tabs',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.TAB_SPAWN,
    async (_event, { tabId, shellType }: { tabId: string; shellType: string }) => {
      try {
        return tabManager.spawnTab(tabId, shellType);
      } catch (error) {
        logger.error('tab:spawn failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to spawn tab shell',
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.TAB_AVAILABLE_SHELLS, async () => {
    try {
      return terminalManager.getAvailableShells();
    } catch (error) {
      logger.error('tab:available-shells failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to detect available shells',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.TAB_RESIZE,
    async (_event, { tabId, cols, rows }: { tabId: string; cols: number; rows: number }) => {
      try {
        tabManager.resizeTab(tabId, cols, rows);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Tab not found:')) {
          logger.debug('Ignoring stale tab:resize for closed tab', { tabId, cols, rows });
          return;
        }
        logger.error('tab:resize failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to resize tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TAB_CREATE_SPLIT,
    async (_event, { primaryTabId, cwd }: { primaryTabId: string; cwd?: string }) => {
      try {
        logger.info('Creating split tab for primary', primaryTabId);
        const dto = tabManager.createTab({ cwd, activate: false });
        logger.info('Created split tab', dto.id);
        return { splitTabId: dto.id };
      } catch (error) {
        logger.error('tab:create-split failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to create split tab',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.TERMINAL_RESIZE,
    async (
      _event,
      { cols, rows }: { cols: number; rows: number },
    ) => {
      try {
        terminalManager.resize(cols, rows);
      } catch (error) {
        logger.error('terminal:resize failed:', error);
        throw new Error(
          error instanceof Error
            ? error.message
            : 'Failed to resize terminal',
        );
      }
    },
  );

  // Window handlers
  ipcMain.handle(CHANNELS.WINDOW_TOGGLE, async () => {
    try {
      await windowManager.toggle();
    } catch (error) {
      logger.error('window:toggle failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to toggle window',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.WINDOW_OPEN_SETTINGS,
    async (_event, { tab }: { tab?: string } = {}) => {
      try {
        await windowManager.openSettingsWindow(tab);
      } catch (error) {
        logger.error('window:open-settings failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to open settings window',
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.WINDOW_CLOSE_SETTINGS, async () => {
    try {
      windowManager.closeSettingsWindow();
    } catch (error) {
      logger.error('window:close-settings failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to close settings window',
      );
    }
  });

  ipcMain.handle(CHANNELS.WINDOW_RESIZE, async () => {
    try {
      windowManager.startResizeDrag();
    } catch (error) {
      logger.error('window:resize failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to start resize drag',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.WINDOW_RESIZE_END,
    async (_event, { persist }: { persist: boolean }) => {
      try {
        windowManager.stopResizeDrag(persist);
      } catch (error) {
        logger.error('window:resize-end failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to end resize drag',
        );
      }
    },
  );

  ipcMain.handle(CHANNELS.WINDOW_RESIZE_RESET, async () => {
    try {
      windowManager.resetWindowHeight();
    } catch (error) {
      logger.error('window:resize-reset failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to reset window height',
      );
    }
  });

  ipcMain.handle(
    CHANNELS.WINDOW_SET_REDUCED_MOTION,
    async (_event, { value }: { value: boolean }) => {
      try {
        windowManager.setReducedMotion(value);
      } catch (error) {
        logger.error('window:set-reduced-motion failed:', error);
        throw new Error(
          error instanceof Error ? error.message : 'Failed to set reduced motion',
        );
      }
    },
  );

  ipcMain.handle(
    CHANNELS.WINDOW_SET_ACRYLIC_BLUR,
    async (_event, { enabled }: { enabled: boolean }) => windowManager.applyAcrylicBlur(enabled),
  );

  ipcMain.handle(CHANNELS.PLATFORM_IS_ACRYLIC_SUPPORTED, async () => {
    const buildNumber = Number.parseInt(os.release().split('.')[2] ?? '0', 10);
    return process.platform === 'win32' && buildNumber >= 22621;
  });

  ipcMain.handle(CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO, async () => {
    if (process.platform !== 'win32') {
      return null;
    }

    const parsedBuildNumber = Number.parseInt(os.release().split('.')[2] ?? '0', 10);
    const buildNumber = Number.isNaN(parsedBuildNumber) ? 0 : parsedBuildNumber;
    return { backend: 'conpty' as const, buildNumber };
  });

  ipcMain.handle(CHANNELS.DISPLAY_GET_ALL, async () => {
    const primaryDisplay = screen.getPrimaryDisplay();

    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Monitor ${index + 1}`,
      bounds: display.bounds,
      isPrimary: display.id === primaryDisplay.id,
    }));
  });

  ipcMain.handle(
    CHANNELS.HOTKEY_REREGISTER,
    async (_event, { newHotkey }: { newHotkey: string }) => {
      const registeredHotkey = hotkeyManager.getRegisteredAccelerator();
      if (registeredHotkey === newHotkey) {
        return { success: true };
      }

      const success = hotkeyManager.reregister(registeredHotkey ?? newHotkey, newHotkey);
      if (success) {
        trayManager.rebuildContextMenu();
        return { success: true };
      }

      return {
        success: false,
        error: `Failed to register hotkey "${newHotkey}"`,
      };
    },
  );

  ipcMain.handle(CHANNELS.APP_REGISTER_CONTEXT_MENU, async () => {
    try {
      registerContextMenu(app.getPath('exe'), getContextMenuAppPath());
      return { success: true };
    } catch (error) {
      logger.error('app:register-context-menu failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to register context menu',
      };
    }
  });

  ipcMain.handle(CHANNELS.APP_DEREGISTER_CONTEXT_MENU, async () => {
    try {
      deregisterContextMenu();
      return { success: true };
    } catch (error) {
      logger.error('app:deregister-context-menu failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deregister context menu',
      };
    }
  });

  ipcMain.handle(CHANNELS.APP_CONTEXT_MENU_STATUS, async () => {
    try {
      return {
        isRegistered: isContextMenuRegistered(),
        available: true,
      };
    } catch (error) {
      logger.error('app:context-menu-status failed:', error);
      return {
        isRegistered: false,
        available: true,
        error: error instanceof Error ? error.message : 'Failed to query context menu status',
      };
    }
  });

  // Forward window state changes to renderer
  windowManager.onStateChange((visible: boolean) => {
    mainWindow.webContents.send(CHANNELS.WINDOW_STATE_CHANGED, { visible });
  });

  // Wire persistent PTY callbacks (survive across respawns)
  terminalManager.onData((tabId: string, data: string) => {
    mainWindow.webContents.send(CHANNELS.TAB_DATA, { tabId, data });
  });

  // Send notification on bell when terminal is hidden
  terminalManager.onBell(() => {
    notificationManager.send({
      title: 'QuakeShell',
      body: 'Terminal is requesting your attention',
      onClick: () => windowManager.toggle(),
    });
  });

  // Notify renderer of PTY exit (no auto-respawn — user presses Enter)
  terminalManager.onExit((exitCode, signal) => {
    const isNormalExit = exitCode === 0;
    if (isNormalExit) {
      logger.info(`Terminal exited normally (code: ${exitCode})`);
    } else {
      logger.warn(`Terminal crashed (code: ${exitCode}, signal: ${signal})`);
    }

    const payload: TerminalProcessExitPayload = { exitCode, signal, isNormalExit };
    mainWindow.webContents.send(CHANNELS.TERMINAL_PROCESS_EXIT, payload);

    // Crash while hidden → send Windows toast notification
    if (!isNormalExit) {
      notificationManager.send({
        title: 'QuakeShell',
        body: 'Shell process exited unexpectedly',
        onClick: () => windowManager.toggle(),
      });
    }
  });

  // Handle respawn request from renderer (user pressed Enter after exit)
  ipcMain.handle(CHANNELS.TERMINAL_RESPAWN, async () => {
    try {
      const shell = terminalManager.getDefaultShell();
      terminalManager.spawn(shell);
    } catch (error) {
      logger.error('terminal:respawn failed:', error);
      throw new Error(
        error instanceof Error ? error.message : 'Failed to respawn terminal',
      );
    }
  });

  // WSL detection handler
  ipcMain.handle(CHANNELS.APP_CHECK_WSL, async () => {
    try {
      const output = execSync('wsl.exe --list --quiet', {
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  });

  ipcMain.handle(CHANNELS.APP_GET_PENDING_UPDATE, async () => {
    return notificationManager.getPendingUpdate();
  });

  ipcMain.handle(CHANNELS.APP_RESTART_PENDING_UPDATE, async () => {
    return notificationManager.restartPendingUpdate();
  });

  ipcMain.handle(CHANNELS.APP_DELAY_PENDING_UPDATE, async () => {
    return notificationManager.delayPendingUpdate();
  });

  const unsubscribePendingUpdate = notificationManager.onPendingUpdateChange((payload) => {
    try {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send(CHANNELS.APP_UPDATE_READY, payload);
    } catch (error) {
      logger.warn('app:update-ready broadcast failed:', error);
    }
  });

  mainWindow.once('closed', () => {
    unsubscribePendingUpdate();
  });

  // Wire config hot-reload: broadcast changes to all renderer windows
  // and apply main-process side effects
  configStore.onDidChange((key, value, oldValue) => {
    // Main-process side effect: opacity
    if (key === 'opacity') {
      windowManager.setOpacity(value as number);
    }
    // Main-process side effect: focus-fade enable/disable
    if (key === 'focusFade') {
      if (value === true) {
        windowManager.setupFocusFade();
      } else {
        windowManager.teardownFocusFade();
      }
    }
    // Main-process side effect: hotkey re-registration
    if (key === 'hotkey') {
      hotkeyManager.reregister(oldValue as string, value as string);
      trayManager.rebuildContextMenu();
    }
    // Main-process side effect: deferred shell change (does NOT kill running PTY)
    if (key === 'defaultShell') {
      terminalManager.setDefaultShell(value as string);
    }
    // Main-process side effect: autostart toggle
    if (key === 'autostart') {
      applyAutostart(value as boolean);
    }
    if (key === 'window') {
      windowManager.applyWindowSettings();
    }
    if (key === 'acrylicBlur') {
      const result = windowManager.applyAcrylicBlur(value as boolean);
      if (!result.success && value === true) {
        logger.warn(`window:set-acrylic-blur failed after config change: ${result.error}`);
      }
    }
    broadcastConfigChange(String(key), value, oldValue);
  });

  logger.info('IPC handlers registered');
}
