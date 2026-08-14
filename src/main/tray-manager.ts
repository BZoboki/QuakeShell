import { Tray, Menu, app, dialog, nativeImage, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import type { UpdateOperationState } from '@shared/ipc-types';
import * as notificationManager from './notification-manager';
import * as windowManager from './window-manager';

const logger = log.scope('tray-manager');
const PROJECT_URL = 'https://github.com/jatson/QuakeShell';

let tray: Tray | null = null;
let toggleCallback: (() => void) | null = null;
let getHotkeyLabel: (() => string) | null = null;
let getConfigPathFn: (() => string) | null = null;
let shutdownCallback: (() => void) | null = null;
let updateOperationState: UpdateOperationState | null = null;
let unsubscribeUpdateOperation: (() => void) | null = null;

function getIconPath(): string {
  return path.join(__dirname, '../../assets/icon.ico');
}

function getUpdateStatusDescription(state: UpdateOperationState | null): string {
  if (!state) {
    return 'No update check has been run.';
  }

  switch (state.phase) {
    case 'checking':
      return 'Checking for updates.';
    case 'available':
      return state.action === 'download'
        ? `Version ${state.latestVersion} is available to download.`
        : `Version ${state.latestVersion} is available to install.`;
    case 'installing':
      return `Installing version ${state.latestVersion}.`;
    case 'ready-to-restart':
      return `Version ${state.latestVersion} is ready to restart.`;
    case 'up-to-date':
      return 'QuakeShell is up to date.';
    case 'error': {
      const failedOperation = state.action === 'install'
        ? 'Update installation'
        : state.action === 'download'
          ? 'Opening the update download'
          : state.action === 'restart'
            ? 'Restarting QuakeShell'
            : 'Update check';
      return `${failedOperation} failed${state.error ? `: ${state.error}` : '.'}`;
    }
  }
}

function buildUpdateMenuItems(): MenuItemConstructorOptions[] {
  const state = updateOperationState;
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates',
    click: () => {
      void notificationManager.checkForUpdates(true);
    },
  };

  if (!state) {
    return [checkForUpdatesItem];
  }

  switch (state.phase) {
    case 'checking':
      return [{ label: 'Checking for Updates...', enabled: false }];
    case 'available':
      if (state.action === 'install') {
        return [
          checkForUpdatesItem,
          {
            label: `Install Update v${state.latestVersion}`,
            click: () => {
              void notificationManager.startAvailableUpdate();
            },
          },
        ];
      }
      if (state.action === 'download') {
        return [
          checkForUpdatesItem,
          {
            label: `Download QuakeShell v${state.latestVersion}`,
            click: () => {
              void notificationManager.openAvailableUpdateDownload();
            },
          },
        ];
      }
      return [checkForUpdatesItem];
    case 'installing':
      return [{ label: `Installing Update v${state.latestVersion}...`, enabled: false }];
    case 'ready-to-restart':
      return [{
        label: `Restart to Apply v${state.latestVersion}`,
        click: () => {
          void notificationManager.restartPendingUpdate();
        },
      }];
    case 'up-to-date':
      return [{ label: 'QuakeShell is up to date', enabled: false }, checkForUpdatesItem];
    case 'error': {
      if (state.action === 'install' && state.latestVersion) {
        return [
          { label: 'Update Installation Failed', enabled: false },
          {
            label: `Retry Install Update v${state.latestVersion}`,
            click: () => {
              void notificationManager.startAvailableUpdate();
            },
          },
        ];
      }
      if (state.action === 'download' && state.latestVersion) {
        return [
          { label: 'Update Download Failed', enabled: false },
          {
            label: `Retry Download QuakeShell v${state.latestVersion}`,
            click: () => {
              void notificationManager.openAvailableUpdateDownload();
            },
          },
        ];
      }
      if (state.action === 'restart' && state.latestVersion) {
        return [
          { label: 'Update Restart Failed', enabled: false },
          {
            label: `Retry Restart to Apply v${state.latestVersion}`,
            click: () => {
              void notificationManager.restartPendingUpdate();
            },
          },
        ];
      }
      return [{ label: 'Update Check Failed', enabled: false }, checkForUpdatesItem];
    }
  }
}

function buildContextMenu(): Menu {
  const hotkeyLabel = getHotkeyLabel?.() ?? '';
  return Menu.buildFromTemplate([
    {
      label: `Toggle Terminal\t${hotkeyLabel}`,
      click: () => toggleCallback?.(),
    },
    { type: 'separator' },
    {
      label: 'Edit Settings',
      click: () => {
        const configPath = getConfigPathFn?.();
        if (configPath) {
          shell.openPath(configPath);
        }
      },
    },
    ...buildUpdateMenuItems(),
    { type: 'separator' },
    {
      label: 'About QuakeShell',
      click: () => {
        const status = getUpdateStatusDescription(updateOperationState);
        void dialog.showMessageBox({
          type: 'info',
          title: 'About QuakeShell',
          message: 'QuakeShell',
          detail: [
            'A drop-down terminal for Windows.',
            `Version ${app.getVersion()}`,
            `Update status: ${status}`,
          ].join('\n'),
          buttons: ['Open Updates', 'Project Page', 'Close'],
          noLink: true,
        }).then(({ response }) => {
          if (response === 0) {
            void windowManager.openSettingsWindow('updates').catch((error) => {
              logger.warn('Failed to open Updates settings:', error);
            });
            return;
          }

          if (response === 1) {
            void shell.openExternal(PROJECT_URL).catch((error) => {
              logger.warn('Failed to open project page:', error);
            });
          }
        }).catch((error) => {
          logger.warn('Failed to show About dialog:', error);
        });
      },
    },
    {
      label: 'Quit',
      click: () => shutdownCallback?.(),
    },
  ]);
}

export interface TrayOptions {
  onToggle: () => void;
  getHotkey: () => string;
  getConfigPath: () => string;
  onQuit: () => void;
}

export function createTray(options: TrayOptions): Tray;
export function createTray(onToggle: () => void): Tray;
export function createTray(optionsOrToggle: TrayOptions | (() => void)): Tray {
  if (typeof optionsOrToggle === 'function') {
    toggleCallback = optionsOrToggle;
  } else {
    toggleCallback = optionsOrToggle.onToggle;
    getHotkeyLabel = optionsOrToggle.getHotkey;
    getConfigPathFn = optionsOrToggle.getConfigPath;
    shutdownCallback = optionsOrToggle.onQuit;
  }

  const iconPath = getIconPath();
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('QuakeShell');

  unsubscribeUpdateOperation?.();
  unsubscribeUpdateOperation = notificationManager.onUpdateOperationChange((state) => {
    updateOperationState = state;
    rebuildContextMenu();
  });
  updateOperationState = notificationManager.getUpdateOperationState();

  tray.setContextMenu(buildContextMenu());

  tray.on('click', () => {
    toggleCallback?.();
  });

  logger.info('Tray created');
  return tray;
}

/** Rebuild the context menu (e.g. when hotkey changes) */
export function rebuildContextMenu(): void {
  if (tray) {
    tray.setContextMenu(buildContextMenu());
  }
}

export function destroyTray(): void {
  unsubscribeUpdateOperation?.();
  unsubscribeUpdateOperation = null;
  updateOperationState = null;

  if (tray) {
    tray.destroy();
    tray = null;
    logger.info('Tray destroyed');
  }
}
