import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
// NOTE: vi.mock factories are hoisted before variable declarations.
// We must use vi.hoisted() so these fns exist when the factory runs.

const {
  mockTrayDestroy,
  mockTraySetToolTip,
  mockTraySetContextMenu,
  mockTraySetImage,
  mockTrayOn,
  mockAppQuit,
  mockAppGetVersion,
  mockDialogShowMessageBox,
  mockShellOpenPath,
  mockShellOpenExternal,
  mockGetUpdateOperationState,
  mockCheckForUpdates,
  mockStartAvailableUpdate,
  mockOpenAvailableUpdateDownload,
  mockRestartPendingUpdate,
  mockUpdateOperationUnsubscribe,
  updateOperationListeners,
  mockOpenSettingsWindow,
} = vi.hoisted(() => ({
  mockTrayDestroy: vi.fn(),
  mockTraySetToolTip: vi.fn(),
  mockTraySetContextMenu: vi.fn(),
  mockTraySetImage: vi.fn(),
  mockTrayOn: vi.fn(),
  mockAppQuit: vi.fn(),
  mockAppGetVersion: vi.fn(() => '1.2.3'),
  mockDialogShowMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  mockShellOpenPath: vi.fn(),
  mockShellOpenExternal: vi.fn(() => Promise.resolve()),
  mockGetUpdateOperationState: vi.fn(() => null),
  mockCheckForUpdates: vi.fn(() => Promise.resolve()),
  mockStartAvailableUpdate: vi.fn(() => Promise.resolve()),
  mockOpenAvailableUpdateDownload: vi.fn(() => Promise.resolve(false)),
  mockRestartPendingUpdate: vi.fn(() => Promise.resolve(false)),
  mockUpdateOperationUnsubscribe: vi.fn(),
  updateOperationListeners: [] as Array<(state: unknown) => void>,
  mockOpenSettingsWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock('electron', () => {
  function MockTray() {
    return {
      destroy: mockTrayDestroy,
      setToolTip: mockTraySetToolTip,
      setContextMenu: mockTraySetContextMenu,
      setImage: mockTraySetImage,
      on: mockTrayOn,
    };
  }

  const Menu = {
    buildFromTemplate: vi.fn((template: unknown[]) => template),
  };

  return {
    Tray: MockTray,
    Menu,
    app: {
      quit: mockAppQuit,
      getVersion: mockAppGetVersion,
    },
    dialog: {
      showMessageBox: mockDialogShowMessageBox,
    },
    nativeImage: {
      createFromPath: vi.fn((p: string) => p),
    },
    shell: {
      openPath: mockShellOpenPath,
      openExternal: mockShellOpenExternal,
    },
  };
});

vi.mock('./notification-manager', () => ({
  getUpdateOperationState: mockGetUpdateOperationState,
  checkForUpdates: mockCheckForUpdates,
  startAvailableUpdate: mockStartAvailableUpdate,
  openAvailableUpdateDownload: mockOpenAvailableUpdateDownload,
  restartPendingUpdate: mockRestartPendingUpdate,
  onUpdateOperationChange: vi.fn((callback: (state: unknown) => void) => {
    updateOperationListeners.push(callback);
    return mockUpdateOperationUnsubscribe;
  }),
}));

vi.mock('./window-manager', () => ({
  openSettingsWindow: mockOpenSettingsWindow,
}));

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

import { Menu, nativeImage } from 'electron';
import { createTray, destroyTray, rebuildContextMenu } from './tray-manager';

function getMenuTemplate(): Array<{ label?: string; type?: string; click?: () => void; enabled?: boolean }> {
  return (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.results[
    (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.results.length - 1
  ].value;
}

function findMenuItem(label: string) {
  const template = getMenuTemplate();
  return template.find((item) => item.label?.startsWith(label));
}

describe('main/tray-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUpdateOperationState.mockReturnValue(null);
    updateOperationListeners.length = 0;
  });

  describe('createTray() — legacy overload', () => {
    it('creates a Tray instance with icon and tooltip', () => {
      const toggleFn = vi.fn();
      createTray(toggleFn);

      expect(mockTraySetToolTip).toHaveBeenCalledWith('QuakeShell');
      expect(mockTraySetContextMenu).toHaveBeenCalled();
    });

    it('registers left-click handler that triggers toggle', () => {
      const toggleFn = vi.fn();
      createTray(toggleFn);

      const clickCall = mockTrayOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      );
      expect(clickCall).toBeDefined();

      const handler = clickCall![1] as () => void;
      handler();
      expect(toggleFn).toHaveBeenCalled();
    });
  });

  describe('createTray() — options overload', () => {
    const defaultOptions = () => ({
      onToggle: vi.fn(),
      getHotkey: vi.fn(() => 'Ctrl+Shift+Q'),
      getConfigPath: vi.fn(() => 'C:\\Users\\test\\config.json'),
      onQuit: vi.fn(),
    });

    it('creates tray with context menu containing all required items in order', () => {
      const opts = defaultOptions();
      createTray(opts);

      const template = getMenuTemplate();
      const labels = template.map((item) => item.label ?? item.type);

      expect(labels).toEqual([
        'Toggle Terminal\tCtrl+Shift+Q',
        'separator',
        'Edit Settings',
        'Check for Updates',
        'separator',
        'About QuakeShell',
        'Quit',
      ]);
    });

    it('Toggle Terminal menu item calls onToggle', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Toggle Terminal');
      item!.click!();
      expect(opts.onToggle).toHaveBeenCalled();
    });

    it('Toggle Terminal shows hotkey label from getHotkey()', () => {
      const opts = defaultOptions();
      opts.getHotkey.mockReturnValue('F12');
      createTray(opts);

      const item = findMenuItem('Toggle Terminal');
      expect(item!.label).toBe('Toggle Terminal\tF12');
    });

    it('Edit Settings calls shell.openPath with config path', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Edit Settings');
      item!.click!();
      expect(mockShellOpenPath).toHaveBeenCalledWith('C:\\Users\\test\\config.json');
    });

    it('Check for Updates starts a visible manual update check', () => {
      createTray(defaultOptions());

      findMenuItem('Check for Updates')!.click!();

      expect(mockCheckForUpdates).toHaveBeenCalledWith(true);
    });

    it('About QuakeShell shows product, version, and update navigation', async () => {
      mockGetUpdateOperationState.mockReturnValue({
        phase: 'available',
        currentVersion: '1.2.3',
        latestVersion: '1.2.4',
        action: 'download',
      });
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('About QuakeShell');
      item!.click!();

      await Promise.resolve();

      expect(mockDialogShowMessageBox).toHaveBeenCalledWith({
        type: 'info',
        title: 'About QuakeShell',
        message: 'QuakeShell',
        detail: [
          'A drop-down terminal for Windows.',
          'Version 1.2.3',
          'Update status: Version 1.2.4 is available to download.',
        ].join('\n'),
        buttons: ['Open Updates', 'Project Page', 'Close'],
        noLink: true,
      });
      expect(mockOpenSettingsWindow).toHaveBeenCalledWith('updates');
    });

    it('About QuakeShell opens the project page when requested', async () => {
      mockDialogShowMessageBox.mockResolvedValueOnce({ response: 1 });
      createTray(defaultOptions());

      findMenuItem('About QuakeShell')!.click!();
      await Promise.resolve();

      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/jatson/QuakeShell');
    });

    it('rebuilds update actions from operation changes and suppresses duplicate checks', () => {
      mockGetUpdateOperationState.mockReturnValue({
        phase: 'checking',
        currentVersion: '1.2.3',
        latestVersion: null,
        action: null,
      });
      createTray(defaultOptions());

      const checkingItem = findMenuItem('Checking for Updates');
      expect(checkingItem?.enabled).toBe(false);
      expect(findMenuItem('Check for Updates')).toBeUndefined();

      const listener = updateOperationListeners[updateOperationListeners.length - 1];
      listener({
        phase: 'available',
        currentVersion: '1.2.3',
        latestVersion: '1.2.4',
        action: 'install',
      });

      const installItem = findMenuItem('Install Update v1.2.4');
      installItem!.click!();

      expect(mockTraySetContextMenu).toHaveBeenCalledTimes(2);
      expect(mockStartAvailableUpdate).toHaveBeenCalledTimes(1);
    });

    it('offers only the main-provided download and restart actions', () => {
      mockGetUpdateOperationState.mockReturnValue({
        phase: 'available',
        currentVersion: '1.2.3',
        latestVersion: '1.2.4',
        action: 'download',
      });
      createTray(defaultOptions());

      findMenuItem('Download QuakeShell v1.2.4')!.click!();
      expect(mockOpenAvailableUpdateDownload).toHaveBeenCalledTimes(1);

      const listener = updateOperationListeners[updateOperationListeners.length - 1];
      listener({
        phase: 'ready-to-restart',
        currentVersion: '1.2.3',
        latestVersion: '1.2.4',
        action: 'restart',
      });

      findMenuItem('Restart to Apply v1.2.4')!.click!();
      expect(mockRestartPendingUpdate).toHaveBeenCalledTimes(1);
    });

    it('shows completed check states and their valid retry actions', () => {
      createTray(defaultOptions());
      const listener = updateOperationListeners[updateOperationListeners.length - 1];

      listener({
        phase: 'up-to-date',
        currentVersion: '1.2.3',
        latestVersion: '1.2.3',
        action: null,
      });
      expect(findMenuItem('QuakeShell is up to date')?.enabled).toBe(false);
      findMenuItem('Check for Updates')!.click!();
      expect(mockCheckForUpdates).toHaveBeenCalledWith(true);

      listener({
        phase: 'error',
        currentVersion: '1.2.3',
        latestVersion: '1.2.4',
        action: 'install',
        error: 'npm failed',
      });
      expect(findMenuItem('Update Installation Failed')?.enabled).toBe(false);
      findMenuItem('Retry Install Update v1.2.4')!.click!();
      expect(mockStartAvailableUpdate).toHaveBeenCalledTimes(1);
    });

    it('Quit calls onQuit callback (graceful shutdown)', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Quit');
      item!.click!();
      expect(opts.onQuit).toHaveBeenCalled();
    });

    it('left-click handler triggers toggle', () => {
      const opts = defaultOptions();
      createTray(opts);

      const clickCall = mockTrayOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      );
      const handler = clickCall![1] as () => void;
      handler();
      expect(opts.onToggle).toHaveBeenCalled();
    });
  });

  describe('tray icon', () => {
    it('uses the root application icon', () => {
      createTray(vi.fn());

      const mockCreateFromPath = nativeImage.createFromPath as ReturnType<typeof vi.fn>;
      const iconPath = mockCreateFromPath.mock.calls[0][0];
      expect(iconPath).toMatch(/[\\/]assets[\\/]icon\.ico$/);
    });
  });

  describe('rebuildContextMenu()', () => {
    it('rebuilds context menu with updated hotkey label', () => {
      const opts = {
        onToggle: vi.fn(),
        getHotkey: vi.fn(() => 'Ctrl+Shift+Q'),
        getConfigPath: vi.fn(() => 'C:\\config.json'),
        onQuit: vi.fn(),
      };
      createTray(opts);

      // Change hotkey
      opts.getHotkey.mockReturnValue('F12');
      rebuildContextMenu();

      // Verify menu was rebuilt
      expect(mockTraySetContextMenu).toHaveBeenCalledTimes(2);
      const item = findMenuItem('Toggle Terminal');
      expect(item!.label).toBe('Toggle Terminal\tF12');
    });
  });

  describe('destroyTray()', () => {
    it('destroys the tray instance', () => {
      createTray(vi.fn());
      const unsubscribeCallCount = mockUpdateOperationUnsubscribe.mock.calls.length;
      destroyTray();
      expect(mockTrayDestroy).toHaveBeenCalled();
      expect(mockUpdateOperationUnsubscribe).toHaveBeenCalledTimes(unsubscribeCallCount + 1);
    });
  });
});
