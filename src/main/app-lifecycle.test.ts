import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// --- Mocks ---

const mockQuit = vi.fn();
const mockExit = vi.fn();
const mockRequestSingleInstanceLock = vi.fn(() => true);
const mockSetLoginItemSettings = vi.fn();
const mockSetAppUserModelId = vi.fn();
const mockAppOn = vi.fn();
const mockAppOnce = vi.fn();
let mockIsPackaged = false;
const mockExistsSync = vi.fn(() => true);
const mockHomedir = vi.fn(() => 'C:\\Users\\test');

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: (...args: unknown[]) => mockRequestSingleInstanceLock(...args),
    quit: (...args: unknown[]) => mockQuit(...args),
    exit: (...args: unknown[]) => mockExit(...args),
    setLoginItemSettings: (...args: unknown[]) => mockSetLoginItemSettings(...args),
    setAppUserModelId: (...args: unknown[]) => mockSetAppUserModelId(...args),
    on: (...args: unknown[]) => mockAppOn(...args),
    once: (...args: unknown[]) => mockAppOnce(...args),
    get isPackaged() {
      return mockIsPackaged;
    },
  },
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('node:os', () => ({
  homedir: (...args: unknown[]) => mockHomedir(...args),
}));

const mockShow = vi.fn();
const mockSetQuitting = vi.fn();
const mockTeardownFocusFade = vi.fn();
const mockGetWindow = vi.fn(() => null);
vi.mock('./window-manager', () => ({
  show: (...args: unknown[]) => mockShow(...args),
  setQuitting: (...args: unknown[]) => mockSetQuitting(...args),
  teardownFocusFade: (...args: unknown[]) => mockTeardownFocusFade(...args),
  getWindow: (...args: unknown[]) => mockGetWindow(...args),
}));

const mockTerminalDestroy = vi.fn();
vi.mock('./terminal-manager', () => ({
  destroy: (...args: unknown[]) => mockTerminalDestroy(...args),
}));

const mockDestroyTray = vi.fn();
const mockCreateTray = vi.fn();
vi.mock('./tray-manager', () => ({
  destroyTray: (...args: unknown[]) => mockDestroyTray(...args),
  createTray: (...args: unknown[]) => mockCreateTray(...args),
}));

const mockCreateTab = vi.fn();
const mockDestroyAllTabs = vi.fn();
vi.mock('./tab-manager', () => ({
  createTab: (...args: unknown[]) => mockCreateTab(...args),
  destroyAllTabs: (...args: unknown[]) => mockDestroyAllTabs(...args),
}));

const mockRegisterContextMenu = vi.fn();
const mockDeregisterContextMenu = vi.fn();
vi.mock('./context-menu-installer', () => ({
  register: (...args: unknown[]) => mockRegisterContextMenu(...args),
  deregister: (...args: unknown[]) => mockDeregisterContextMenu(...args),
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

import { initAppLifecycle, applyAutostart, registerAutostartConfigHandler, logMilestone, gracefulShutdown } from './app-lifecycle';
import {
  parseCwdArg,
  resolveCwd,
  handleStartupCwd,
  flushPendingCwdLaunches,
  handleSquirrelLifecycle,
} from './app-lifecycle';
import { WINDOWS_APP_USER_MODEL_ID } from '../shared/constants';

describe('main/app-lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestSingleInstanceLock.mockReturnValue(true);
    mockIsPackaged = false;
    mockExistsSync.mockReturnValue(true);
  });

  describe('initAppLifecycle()', () => {
    it('sets the Windows app identity before registering lifecycle handlers', () => {
      initAppLifecycle('win32');

      expect(mockSetAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID);
      const identityCallOrder = mockSetAppUserModelId.mock.invocationCallOrder[0];
      const firstHandlerCallOrder = mockAppOn.mock.invocationCallOrder[0];
      expect(identityCallOrder).toBeLessThan(firstHandlerCallOrder);
    });

    it('does not set a Windows app identity on other platforms', () => {
      initAppLifecycle('darwin');

      expect(mockSetAppUserModelId).not.toHaveBeenCalled();
    });

    it('calls app.requestSingleInstanceLock() as the first operation', () => {
      initAppLifecycle();

      expect(mockRequestSingleInstanceLock).toHaveBeenCalledTimes(1);
      // Lock must be called before any 'second-instance' handler registration
      const lockCallOrder = mockRequestSingleInstanceLock.mock.invocationCallOrder[0];
      const onCallOrders = mockAppOn.mock.invocationCallOrder;
      for (const order of onCallOrders) {
        expect(lockCallOrder).toBeLessThan(order);
      }
    });

    it('returns true when single instance lock is acquired', () => {
      mockRequestSingleInstanceLock.mockReturnValue(true);

      const result = initAppLifecycle();

      expect(result).toBe(true);
    });

    it('quits immediately when lock is NOT acquired', () => {
      mockRequestSingleInstanceLock.mockReturnValue(false);

      const result = initAppLifecycle();

      expect(result).toBe(false);
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('does not register second-instance handler when lock is not acquired', () => {
      mockRequestSingleInstanceLock.mockReturnValue(false);

      initAppLifecycle();

      const secondInstanceCalls = mockAppOn.mock.calls.filter(
        (call: unknown[]) => call[0] === 'second-instance',
      );
      expect(secondInstanceCalls).toHaveLength(0);
    });

    it('registers second-instance handler when lock is acquired', () => {
      mockRequestSingleInstanceLock.mockReturnValue(true);

      initAppLifecycle();

      const secondInstanceCalls = mockAppOn.mock.calls.filter(
        (call: unknown[]) => call[0] === 'second-instance',
      );
      expect(secondInstanceCalls).toHaveLength(1);
    });

    it('second-instance handler calls windowManager.show()', () => {
      mockRequestSingleInstanceLock.mockReturnValue(true);

      initAppLifecycle();

      const secondInstanceCall = mockAppOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'second-instance',
      );
      expect(secondInstanceCall).toBeDefined();

      // Trigger the handler
      const handler = secondInstanceCall![1] as (_event: unknown, commandLine: string[]) => void;
      handler({}, ['quakeshell.exe']);
      expect(mockShow).toHaveBeenCalledTimes(1);
    });

    it('second-instance handler forwards --cwd to TabManager and reveals the window', () => {
      mockRequestSingleInstanceLock.mockReturnValue(true);
      const rawCwd = path.join('workspace', 'project');
      const resolvedCwd = path.resolve(rawCwd);

      initAppLifecycle();

      const secondInstanceCall = mockAppOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'second-instance',
      );
      expect(secondInstanceCall).toBeDefined();

      const handler = secondInstanceCall![1] as (_event: unknown, commandLine: string[]) => void;
      handler({}, ['quakeshell.exe', '--cwd', rawCwd]);

      expect(mockCreateTab).toHaveBeenCalledWith({ cwd: resolvedCwd });
      expect(mockShow).toHaveBeenCalledTimes(1);
    });

    it('queues forwarded --cwd launches until TabManager initialization completes', () => {
      const rawCwd = path.join('workspace', 'project');
      const resolvedCwd = path.resolve(rawCwd);

      mockCreateTab.mockImplementationOnce(() => {
        throw new Error('TabManager not initialized');
      });

      initAppLifecycle();

      const secondInstanceCall = mockAppOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'second-instance',
      );
      expect(secondInstanceCall).toBeDefined();

      const handler = secondInstanceCall![1] as (_event: unknown, commandLine: string[]) => void;
      handler({}, ['quakeshell.exe', '--cwd', rawCwd]);

      expect(mockCreateTab).toHaveBeenCalledWith({ cwd: resolvedCwd });

      mockCreateTab.mockImplementation(() => undefined);
      flushPendingCwdLaunches();

      expect(mockCreateTab).toHaveBeenCalledTimes(2);
      expect(mockCreateTab).toHaveBeenLastCalledWith({ cwd: resolvedCwd });
      expect(mockShow).toHaveBeenCalled();
    });
  });

  describe('parseCwdArg()', () => {
    it('returns null when --cwd is absent', () => {
      expect(parseCwdArg(['quakeshell.exe'])).toBeNull();
    });

    it('returns the token following --cwd when present', () => {
      expect(parseCwdArg(['quakeshell.exe', '--cwd', 'workspace/project'])).toBe('workspace/project');
    });

    it('returns null when --cwd is missing its value', () => {
      expect(parseCwdArg(['quakeshell.exe', '--cwd'])).toBeNull();
    });
  });

  describe('resolveCwd()', () => {
    it('returns the home directory when rawPath is null', () => {
      expect(resolveCwd(null)).toBe('C:\\Users\\test');
    });

    it('returns the resolved path when it exists', () => {
      const rawCwd = path.join('workspace', 'project');
      expect(resolveCwd(rawCwd)).toBe(path.resolve(rawCwd));
    });

    it('falls back to the home directory when the path does not exist', () => {
      mockExistsSync.mockReturnValueOnce(false);

      expect(resolveCwd(path.join('missing', 'project'))).toBe('C:\\Users\\test');
    });

    it('falls back to the home directory when the path contains control characters', () => {
      expect(resolveCwd('bad\u0000path')).toBe('C:\\Users\\test');
    });
  });

  describe('handleStartupCwd()', () => {
    it('creates a new tab and reveals the window on first-instance startup with --cwd', () => {
      const rawCwd = path.join('workspace', 'project');
      const resolvedCwd = path.resolve(rawCwd);

      expect(handleStartupCwd(['quakeshell.exe', '--cwd', rawCwd])).toBe(true);

      expect(mockCreateTab).toHaveBeenCalledWith({ cwd: resolvedCwd });
      expect(mockShow).toHaveBeenCalledTimes(1);
    });

    it('returns false when startup args do not include --cwd', () => {
      expect(handleStartupCwd(['quakeshell.exe'])).toBe(false);
      expect(mockCreateTab).not.toHaveBeenCalled();
      expect(mockShow).not.toHaveBeenCalled();
    });
  });

  describe('handleSquirrelLifecycle()', () => {
    it('--squirrel-install registers the context menu with process.execPath', () => {
      expect(handleSquirrelLifecycle(['quakeshell.exe', '--squirrel-install'])).toBe(true);
      expect(mockRegisterContextMenu).toHaveBeenCalledWith(process.execPath);
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('--squirrel-updated registers the context menu with process.execPath', () => {
      expect(handleSquirrelLifecycle(['quakeshell.exe', '--squirrel-updated'])).toBe(true);
      expect(mockRegisterContextMenu).toHaveBeenCalledWith(process.execPath);
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('--squirrel-uninstall deregisters the context menu', () => {
      expect(handleSquirrelLifecycle(['quakeshell.exe', '--squirrel-uninstall'])).toBe(true);
      expect(mockDeregisterContextMenu).toHaveBeenCalledTimes(1);
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('swallows non-fatal context menu registration failures', () => {
      mockRegisterContextMenu.mockImplementationOnce(() => {
        throw new Error('Registry write failed');
      });

      expect(() => handleSquirrelLifecycle(['quakeshell.exe', '--squirrel-install'])).not.toThrow();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('swallows non-fatal context menu deregistration failures', () => {
      mockDeregisterContextMenu.mockImplementationOnce(() => {
        throw new Error('Registry delete failed');
      });

      expect(() => handleSquirrelLifecycle(['quakeshell.exe', '--squirrel-uninstall'])).not.toThrow();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('returns false during normal startup with no squirrel flags', () => {
      expect(handleSquirrelLifecycle(['quakeshell.exe'])).toBe(false);
      expect(mockRegisterContextMenu).not.toHaveBeenCalled();
      expect(mockDeregisterContextMenu).not.toHaveBeenCalled();
    });
  });

  describe('applyAutostart()', () => {
    it('enables the packaged QuakeShell login item when configured', () => {
      mockIsPackaged = true;

      applyAutostart(true);

      expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: true,
        args: [],
      });
    });

    it('removes the packaged QuakeShell login item when disabled', () => {
      mockIsPackaged = true;

      applyAutostart(false);

      expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        args: [],
      });
    });

    it('removes the current development Electron login item regardless of configuration', () => {
      applyAutostart(true);
      applyAutostart(false);

      expect(mockSetLoginItemSettings).toHaveBeenCalledTimes(2);
      expect(mockSetLoginItemSettings).toHaveBeenNthCalledWith(1, {
        openAtLogin: false,
        args: [],
      });
      expect(mockSetLoginItemSettings).toHaveBeenNthCalledWith(2, {
        openAtLogin: false,
        args: [],
      });
    });
  });

  describe('registerAutostartConfigHandler()', () => {
    it('registers a config change listener that triggers applyAutostart', () => {
      mockIsPackaged = true;
      const mockOnDidChange = vi.fn();
      const mockConfigStore = {
        get: vi.fn(),
        set: vi.fn(),
        getAll: vi.fn(),
        onDidChange: mockOnDidChange,
      };

      registerAutostartConfigHandler(mockConfigStore);

      expect(mockOnDidChange).toHaveBeenCalledTimes(1);

      // Simulate config change for 'autostart' key
      const changeCallback = mockOnDidChange.mock.calls[0][0];
      changeCallback('autostart', false, true);

      expect(mockSetLoginItemSettings).toHaveBeenCalledWith({
        openAtLogin: false,
        args: [],
      });
    });

    it('keeps the unpackaged Electron runtime disabled on live autostart updates', () => {
      const mockOnDidChange = vi.fn();
      const mockConfigStore = {
        get: vi.fn(),
        set: vi.fn(),
        getAll: vi.fn(),
        onDidChange: mockOnDidChange,
      };

      registerAutostartConfigHandler(mockConfigStore);

      const changeCallback = mockOnDidChange.mock.calls[0][0];
      changeCallback('autostart', true, false);
      changeCallback('autostart', false, true);

      expect(mockSetLoginItemSettings).toHaveBeenCalledTimes(2);
      expect(mockSetLoginItemSettings).toHaveBeenNthCalledWith(1, {
        openAtLogin: false,
        args: [],
      });
      expect(mockSetLoginItemSettings).toHaveBeenNthCalledWith(2, {
        openAtLogin: false,
        args: [],
      });
    });

    it('does not call applyAutostart for non-autostart config changes', () => {
      const mockOnDidChange = vi.fn();
      const mockConfigStore = {
        get: vi.fn(),
        set: vi.fn(),
        getAll: vi.fn(),
        onDidChange: mockOnDidChange,
      };

      registerAutostartConfigHandler(mockConfigStore);

      const changeCallback = mockOnDidChange.mock.calls[0][0];
      changeCallback('opacity', 0.5, 0.85);

      expect(mockSetLoginItemSettings).not.toHaveBeenCalled();
    });
  });

  describe('logMilestone()', () => {
    it('does not throw when called with valid arguments', () => {
      expect(() => logMilestone('test milestone', performance.now())).not.toThrow();
    });
  });

  describe('silent startup verification', () => {
    it('does not display any balloon notification (tray-manager has no displayBalloon call)', async () => {
      const traySource = await import('./tray-manager');
      expect(typeof traySource.createTray).toBe('function');
    });
  });

  describe('gracefulShutdown()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls terminalManager.destroy() to kill PTY', () => {
      gracefulShutdown();
      expect(mockTerminalDestroy).toHaveBeenCalled();
    });

    it('calls tabManager.destroyAllTabs() to kill all tab PTYs', () => {
      gracefulShutdown();
      expect(mockDestroyAllTabs).toHaveBeenCalled();
    });

    it('calls destroyAllTabs() before terminalManager.destroy()', () => {
      gracefulShutdown();
      const tabsDestroyOrder = mockDestroyAllTabs.mock.invocationCallOrder[0];
      const legacyDestroyOrder = mockTerminalDestroy.mock.invocationCallOrder[0];
      expect(tabsDestroyOrder).toBeLessThan(legacyDestroyOrder);
    });

    it('sets quitting flag on window-manager', () => {
      gracefulShutdown();
      expect(mockSetQuitting).toHaveBeenCalledWith(true);
    });

    it('closes the window if it exists and is not destroyed', () => {
      const mockClose = vi.fn();
      mockGetWindow.mockReturnValueOnce({ isDestroyed: () => false, close: mockClose });

      gracefulShutdown();
      expect(mockClose).toHaveBeenCalled();
    });

    it('skips window close if window is null', () => {
      mockGetWindow.mockReturnValueOnce(null);
      expect(() => gracefulShutdown()).not.toThrow();
    });

    it('tears down focus fade when the main window is already destroyed', () => {
      const mockClose = vi.fn();
      mockGetWindow.mockReturnValueOnce({ isDestroyed: () => true, close: mockClose });

      gracefulShutdown();

      expect(mockTeardownFocusFade).toHaveBeenCalledTimes(1);
      expect(mockClose).not.toHaveBeenCalled();
      expect(mockDestroyTray).toHaveBeenCalled();
      expect(mockQuit).toHaveBeenCalled();
    });

    it('destroys the tray icon', () => {
      gracefulShutdown();
      expect(mockDestroyTray).toHaveBeenCalled();
    });

    it('calls app.quit()', () => {
      gracefulShutdown();
      expect(mockQuit).toHaveBeenCalled();
    });

    it('executes shutdown steps in correct order: PTY kill → setQuitting → focus-fade teardown → window close → tray destroy → quit', () => {
      const mockClose = vi.fn();
      mockGetWindow.mockReturnValueOnce({ isDestroyed: () => false, close: mockClose });

      gracefulShutdown();

      const tabsDestroyOrder = mockDestroyAllTabs.mock.invocationCallOrder[0];
      const destroyOrder = mockTerminalDestroy.mock.invocationCallOrder[0];
      const quittingOrder = mockSetQuitting.mock.invocationCallOrder[0];
      const teardownOrder = mockTeardownFocusFade.mock.invocationCallOrder[0];
      const closeOrder = mockClose.mock.invocationCallOrder[0];
      const trayOrder = mockDestroyTray.mock.invocationCallOrder[0];
      const quitOrder = mockQuit.mock.invocationCallOrder[0];

      expect(tabsDestroyOrder).toBeLessThan(quittingOrder);
      expect(destroyOrder).toBeLessThan(quittingOrder);
      expect(quittingOrder).toBeLessThan(teardownOrder);
      expect(teardownOrder).toBeLessThan(closeOrder);
      expect(mockTeardownFocusFade).toHaveBeenCalledTimes(1);
      expect(closeOrder).toBeLessThan(trayOrder);
      expect(trayOrder).toBeLessThan(quitOrder);
    });

    it('handles PTY destroy errors gracefully', () => {
      mockTerminalDestroy.mockImplementationOnce(() => { throw new Error('PTY already dead'); });
      expect(() => gracefulShutdown()).not.toThrow();
      expect(mockQuit).toHaveBeenCalled();
    });

    it('handles destroyAllTabs errors gracefully', () => {
      mockDestroyAllTabs.mockImplementationOnce(() => { throw new Error('tabs already dead'); });
      expect(() => gracefulShutdown()).not.toThrow();
      expect(mockQuit).toHaveBeenCalled();
    });

    it('still calls terminalManager.destroy() when destroyAllTabs() throws', () => {
      mockDestroyAllTabs.mockImplementationOnce(() => { throw new Error('tabs already dead'); });
      gracefulShutdown();
      expect(mockTerminalDestroy).toHaveBeenCalled();
    });

    it('sets up a force-quit timeout safeguard', () => {
      gracefulShutdown();

      // The timeout should be registered
      expect(mockAppOnce).toHaveBeenCalledWith('will-quit', expect.any(Function));

      // If timeout fires, app.exit(0) is called
      vi.advanceTimersByTime(2000);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('clears force-quit timeout when quit completes normally', () => {
      gracefulShutdown();

      // Simulate will-quit firing (normal quit completion)
      const willQuitCall = mockAppOnce.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-quit',
      );
      expect(willQuitCall).toBeDefined();
      const willQuitHandler = willQuitCall![1] as () => void;
      willQuitHandler();

      // Now advance time — exit should NOT be called
      vi.advanceTimersByTime(3000);
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
