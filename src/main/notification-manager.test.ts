import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  MockNotification,
  mockAppQuit,
  mockGetVersion,
  mockShellOpenExternal,
  mockSpawn,
} = vi.hoisted(() => ({
  MockNotification: vi.fn(function (this: any) {
    this.on = vi.fn();
    this.show = vi.fn();
  }),
  mockAppQuit: vi.fn(),
  mockGetVersion: vi.fn(() => '1.0.0'),
  mockShellOpenExternal: vi.fn(() => Promise.resolve()),
  mockSpawn: vi.fn(),
}));

vi.mock('electron', () => ({
  Notification: MockNotification,
  app: {
    quit: mockAppQuit,
    getVersion: mockGetVersion,
  },
  shell: {
    openExternal: mockShellOpenExternal,
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('electron-log/main', () => {
  const scopedLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  };
  return {
    default: {
      scope: vi.fn(() => scopedLogger),
    },
  };
});

vi.mock('./window-manager', () => ({
  isVisible: vi.fn(() => false),
  getWindow: vi.fn(() => ({
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => false),
  })),
  toggle: vi.fn(),
  openSettingsWindow: vi.fn(() => Promise.resolve()),
}));

import * as windowManager from './window-manager';
import {
  send,
  isNotificationSuppressed,
  checkForUpdates,
  getUpdateOperationState,
  onUpdateOperationChange,
  getPendingUpdate,
  openAvailableUpdateDownload,
  restartPendingUpdate,
  setUpdateRestartHandler,
  startAvailableUpdate,
  _reset,
} from './notification-manager';

function createMockChildProcess() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const child = {
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
      return child;
    }),
    unref: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners.get(event) ?? []) {
        handler(...args);
      }
    },
  };

  return child;
}

type MockNotificationInstance = {
  on: {
    mock: {
      calls: Array<[string, unknown]>;
    };
  };
};

function getLatestNotificationClickHandler(): () => void {
  const notification = MockNotification.mock.instances.at(-1) as MockNotificationInstance | undefined;
  const clickCall = notification?.on.mock.calls.find(([eventName]) => eventName === 'click');
  const clickHandler = clickCall?.[1];

  if (typeof clickHandler !== 'function') {
    throw new Error('Expected the latest notification to register a click handler');
  }

  return clickHandler as () => void;
}

function createTempDirectory(prefix = 'quakeshell-update-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const originalExecPath = process.execPath;
const temporaryPaths: string[] = [];

describe('main/notification-manager', () => {
  beforeEach(() => {
    _reset();
    MockNotification.mockClear();
    mockAppQuit.mockClear();
    mockShellOpenExternal.mockClear();
    mockSpawn.mockReset();
    // Re-apply constructor body after mockClear (which preserves implementation)
    // but NOT vi.restoreAllMocks() which would strip the vi.hoisted implementation
    MockNotification.mockImplementation(function (this: any) {
      this.on = vi.fn();
      this.show = vi.fn();
    });
    process.execPath = originalExecPath;
    vi.unstubAllEnvs();
    vi.mocked(windowManager.isVisible).mockReturnValue(false);
    vi.mocked(windowManager.getWindow).mockReturnValue({
      isDestroyed: vi.fn(() => false),
      isFocused: vi.fn(() => false),
    } as any);
    vi.mocked(windowManager.toggle).mockClear();
    vi.mocked(windowManager.openSettingsWindow).mockClear();
    mockGetVersion.mockReturnValue('1.0.0');
    setUpdateRestartHandler(null);
  });

  afterEach(() => {
    _reset();
    process.execPath = originalExecPath;
    vi.unstubAllEnvs();
    setUpdateRestartHandler(null);
    while (temporaryPaths.length > 0) {
      fs.rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
    }
  });

  describe('isNotificationSuppressed()', () => {
    it('returns false when terminal is hidden', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(false);
      expect(isNotificationSuppressed()).toBe(false);
    });

    it('returns false when terminal is visible but not focused', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(true);
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => false),
      } as any);
      expect(isNotificationSuppressed()).toBe(false);
    });

    it('returns true when terminal is visible and focused', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(true);
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => true),
      } as any);
      expect(isNotificationSuppressed()).toBe(true);
    });
  });

  describe('send()', () => {
    function getLastInstance() {
      const instances = MockNotification.mock.instances;
      return instances[instances.length - 1] as any;
    }

    it('creates and shows a notification with title and body', () => {
      send({ title: 'Test', body: 'Hello' });

      expect(MockNotification).toHaveBeenCalledWith({
        title: 'Test',
        body: 'Hello',
      });
      expect(getLastInstance().show).toHaveBeenCalled();
    });

    it('registers click handler that calls provided onClick callback', () => {
      const onClick = vi.fn();
      send({ title: 'Test', body: 'Hello', onClick });

      const inst = getLastInstance();
      const clickHandler = inst.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      )![1] as () => void;

      clickHandler();
      expect(onClick).toHaveBeenCalled();
    });

    it('defaults click handler to windowManager.toggle() when no onClick provided', () => {
      send({ title: 'Test', body: 'Hello' });

      const inst = getLastInstance();
      const clickHandler = inst.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      )![1] as () => void;

      clickHandler();
      expect(windowManager.toggle).toHaveBeenCalled();
    });

    it('suppresses notification when terminal is visible and focused', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(true);
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => true),
      } as any);

      send({ title: 'Test', body: 'Hello' });

      expect(MockNotification).not.toHaveBeenCalled();
    });

    it('does NOT suppress when terminal is visible but unfocused', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(true);
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => false),
      } as any);

      send({ title: 'Test', body: 'Hello' });

      expect(MockNotification).toHaveBeenCalled();
      expect(getLastInstance().show).toHaveBeenCalled();
    });

    it('can bypass suppression for forced notifications', () => {
      vi.mocked(windowManager.isVisible).mockReturnValue(true);
      vi.mocked(windowManager.getWindow).mockReturnValue({
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => true),
      } as any);

      send({ title: 'Test', body: 'Hello', bypassSuppression: true });

      expect(MockNotification).toHaveBeenCalledWith({
        title: 'Test',
        body: 'Hello',
      });
      expect(getLastInstance().show).toHaveBeenCalled();
    });
  });

  describe('checkForUpdates()', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    it('shows notification when newer version available', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      const result = await checkForUpdates(false);

      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe('2.0.0');
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'QuakeShell v2.0.0 available. Click to download.',
      });
    });

    it('opens the latest release page when update click occurs outside npm-managed installs', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(false);

      const notification = MockNotification.mock.instances[MockNotification.mock.instances.length - 1] as any;
      const clickHandler = notification.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      )![1] as () => void;

      clickHandler();

      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/jatson/QuakeShell/releases/tag/v2.0.0');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('keeps a manually discovered npm update available until the user starts it', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );

      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(true);

      expect(getUpdateOperationState()).toEqual({
        phase: 'available',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'install',
      });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('does not auto-install a version the user left available after a manual check', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(true);
      await checkForUpdates(false);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(getUpdateOperationState()).toEqual({
        phase: 'available',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'install',
      });
    });

    it('starts a manually available npm update only after the user chooses Install Update', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(true);
      const installPromise = startAvailableUpdate();

      expect(getUpdateOperationState()?.phase).toBe('installing');
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm.cmd',
        ['install', '-g', 'quakeshell@2.0.0'],
        expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
      );

      installChild.emit('exit', 0);
      await expect(installPromise).resolves.toEqual({
        phase: 'ready-to-restart',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'restart',
      });
      expect(getPendingUpdate()).toEqual({ version: '2.0.0', source: 'background-install' });

      await expect(checkForUpdates(true)).resolves.toEqual({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getUpdateOperationState()).toEqual({
        phase: 'ready-to-restart',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'restart',
      });
      expect(getPendingUpdate()).toEqual({ version: '2.0.0', source: 'background-install' });
    });

    it('keeps a failed manual install visible and retryable without interrupting the terminal', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild as any);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(true);
      const installPromise = startAvailableUpdate();
      installChild.emit('exit', 1);

      await expect(installPromise).resolves.toEqual({
        phase: 'error',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'install',
        error: 'npm install failed with exit code 1 for quakeshell@2.0.0',
      });
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'Update installation failed. Click to retry QuakeShell v2.0.0.',
      });
      const retryClick = getLatestNotificationClickHandler();
      retryClick();
      await Promise.resolve();
      expect(windowManager.openSettingsWindow).toHaveBeenCalledWith('updates');
      expect(getPendingUpdate()).toBeNull();
    });

    it('offers the validated release page for a manually discovered unsupported update', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(true);

      expect(getUpdateOperationState()).toEqual({
        phase: 'available',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'download',
      });
      await expect(openAvailableUpdateDownload()).resolves.toBe(true);
      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/jatson/QuakeShell/releases/tag/v2.0.0');
    });

    it('keeps a failed release-page launch visible and retryable', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);
      mockShellOpenExternal.mockRejectedValueOnce(new Error('Browser unavailable'));

      await checkForUpdates(true);

      await expect(openAvailableUpdateDownload()).resolves.toBe(false);
      expect(getUpdateOperationState()).toEqual({
        phase: 'error',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'download',
        error: 'Browser unavailable',
      });
    });

    it('starts a silent background install for npm-managed builds and restarts into the new executable when requested later', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );

      const installChild = createMockChildProcess();
      const restartChild = createMockChildProcess();
      mockSpawn
        .mockImplementationOnce(() => installChild as any)
        .mockImplementationOnce(() => restartChild as any);

      const restartHandler = vi.fn();
      setUpdateRestartHandler(restartHandler);

      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(false);

      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'npm.cmd',
        ['install', '-g', 'quakeshell@2.0.0'],
        expect.objectContaining({
          stdio: 'ignore',
          windowsHide: true,
        }),
      );
      expect(MockNotification).not.toHaveBeenCalled();

      const updatedExecutablePath = path.join(
        installRoot,
        'versions',
        '2.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      fs.mkdirSync(path.dirname(updatedExecutablePath), { recursive: true });
      fs.writeFileSync(updatedExecutablePath, 'exe');

      installChild.emit('exit', 0);

      await vi.waitFor(() => {
        expect(getPendingUpdate()).toEqual({
          version: '2.0.0',
          source: 'background-install',
        });
      });

      const restartPromise = restartPendingUpdate();

      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        updatedExecutablePath,
        [],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }),
      );

      restartChild.emit('spawn');

      await expect(restartPromise).resolves.toBe(true);

      await vi.waitFor(() => {
        expect(restartHandler).toHaveBeenCalled();
      });
      expect(getPendingUpdate()).toBeNull();
    });

    it('keeps a scheduled install failure quiet', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(false);
      expect(getUpdateOperationState()?.phase).toBe('installing');

      installChild.emit('exit', 1);

      await vi.waitFor(() => {
        expect(getUpdateOperationState()).toBeNull();
      });
      expect(MockNotification).not.toHaveBeenCalled();
      expect(getPendingUpdate()).toBeNull();
    });

    it('returns false when restartPendingUpdate is called without a pending update', async () => {
      await expect(restartPendingUpdate()).resolves.toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('shows a retryable download error when restart fallback cannot open the release page', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);
      mockShellOpenExternal.mockRejectedValueOnce(new Error('Browser unavailable'));

      await checkForUpdates(false);
      installChild.emit('exit', 0);
      await vi.waitFor(() => {
        expect(getPendingUpdate()).toEqual({ version: '2.0.0', source: 'background-install' });
      });

      await expect(restartPendingUpdate()).resolves.toBe(false);

      expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/jatson/QuakeShell/releases/tag/v2.0.0');
      expect(getPendingUpdate()).toBeNull();
      expect(getUpdateOperationState()).toEqual({
        phase: 'error',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: 'download',
        error: 'Installed executable for QuakeShell v2.0.0 was not found. Could not open the download page: Browser unavailable',
      });
    });

    it('rejects invalid registry versions before notifying or spawning npm', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );

      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0 & calc.exe' }),
      } as Response);

      const result = await checkForUpdates(false);

      expect(result.updateAvailable).toBe(false);
      expect(result.error).toBe('Invalid response: invalid version field');
      expect(MockNotification).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('does not notify on periodic check when same version', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);

      const result = await checkForUpdates(false);

      expect(result.updateAvailable).toBe(false);
      expect(MockNotification).not.toHaveBeenCalled();
      expect(getUpdateOperationState()).toBeNull();
    });

    it('shows "up to date" notification on manual check when same version', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);

      const result = await checkForUpdates(true);

      expect(result.updateAvailable).toBe(false);
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'QuakeShell is up to date',
      });
    });

    it('quietly replaces a stale visible error after a scheduled no-update result', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '1.0.0' }),
        } as Response);

      await checkForUpdates(true);
      await checkForUpdates(false);

      expect(getUpdateOperationState()).toEqual({
        phase: 'up-to-date',
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        action: null,
      });
      expect(MockNotification).toHaveBeenCalledTimes(1);
      expect(MockNotification).toHaveBeenLastCalledWith({
        title: 'QuakeShell',
        body: 'Update check failed. Click to try again.',
      });
    });

    it('handles network error gracefully — no notification, no throw', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await checkForUpdates(false);

      expect(result.updateAvailable).toBe(false);
      expect(result.error).toBe('Network error');
      expect(MockNotification).not.toHaveBeenCalled();
      expect(getUpdateOperationState()).toBeNull();
    });

    it('shows a visible, retryable state when a manual check fails', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await checkForUpdates(true);

      expect(result.error).toBe('Network error');
      expect(getUpdateOperationState()).toEqual({
        phase: 'error',
        currentVersion: '1.0.0',
        latestVersion: null,
        action: null,
        error: 'Network error',
      });
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'Update check failed. Click to try again.',
      });
    });

    it('suppresses duplicate manual checks while the first request is active', async () => {
      let resolveFetch!: (response: Response) => void;
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((resolve) => {
        resolveFetch = resolve;
      }));

      const firstCheck = checkForUpdates(true);
      const secondCheck = checkForUpdates(true);

      expect(secondCheck).toBe(firstCheck);
      expect(getUpdateOperationState()?.phase).toBe('checking');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);
      await expect(firstCheck).resolves.toMatchObject({ updateAvailable: false });
    });

    it('makes a scheduled check visible when a user requests an update check while it is running', async () => {
      let resolveFetch!: (response: Response) => void;
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((resolve) => {
        resolveFetch = resolve;
      }));

      const scheduledCheck = checkForUpdates(false);
      const manualCheck = checkForUpdates(true);

      expect(manualCheck).toBe(scheduledCheck);
      expect(getUpdateOperationState()).toEqual({
        phase: 'checking',
        currentVersion: '1.0.0',
        latestVersion: null,
        action: null,
      });

      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);

      await expect(scheduledCheck).resolves.toMatchObject({ updateAvailable: false });
      expect(getUpdateOperationState()).toEqual({
        phase: 'up-to-date',
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        action: null,
      });
      expect(MockNotification).toHaveBeenCalledWith({
        title: 'QuakeShell',
        body: 'QuakeShell is up to date',
      });
    });

    it('does not replace an active scheduled install with a manual checking state', async () => {
      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.0' }),
      } as Response);

      await checkForUpdates(false);
      const manualCheck = await checkForUpdates(true);

      expect(manualCheck).toEqual({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getUpdateOperationState()).toEqual({
        phase: 'installing',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: null,
      });

      installChild.emit('exit', 1);
      await vi.waitFor(() => {
        expect(getUpdateOperationState()).toEqual({
          phase: 'error',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          action: 'install',
          error: 'npm install failed with exit code 1 for quakeshell@2.0.0',
        });
      });
    });

    it('does not let a stale check retry notification replace an active install', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ version: '2.0.0' }),
        } as Response);

      await checkForUpdates(true);
      const retryClick = getLatestNotificationClickHandler();

      const installRoot = createTempDirectory();
      temporaryPaths.push(installRoot);
      vi.stubEnv('QUAKESHELL_INSTALL_ROOT', installRoot);
      process.execPath = path.join(
        installRoot,
        'versions',
        '1.0.0-win32-x64',
        'quakeshell-win32-x64',
        'quakeshell.exe',
      );
      const installChild = createMockChildProcess();
      mockSpawn.mockImplementationOnce(() => installChild);

      await checkForUpdates(false);
      retryClick();
      await Promise.resolve();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(getUpdateOperationState()).toEqual({
        phase: 'installing',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        action: null,
      });

      installChild.emit('exit', 1);
      await vi.waitFor(() => {
        expect(getUpdateOperationState()?.action).toBe('install');
      });
    });

    it('stops notifying an update-operation listener after unsubscription', async () => {
      const listener = vi.fn();
      const unsubscribe = onUpdateOperationChange(listener);
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);

      await checkForUpdates(true);
      const notificationCount = listener.mock.calls.length;
      unsubscribe();

      await checkForUpdates(true);
      expect(listener).toHaveBeenCalledTimes(notificationCount);
    });

    it('handles HTTP error gracefully', async () => {
      mockGetVersion.mockReturnValue('1.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await checkForUpdates(false);

      expect(result.updateAvailable).toBe(false);
      expect(result.error).toBe('HTTP 500');
    });

    it('detects minor version update correctly', async () => {
      mockGetVersion.mockReturnValue('1.2.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.3.0' }),
      } as Response);

      const result = await checkForUpdates(false);
      expect(result.updateAvailable).toBe(true);
    });

    it('detects patch version update correctly', async () => {
      mockGetVersion.mockReturnValue('1.2.3');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.2.4' }),
      } as Response);

      const result = await checkForUpdates(false);
      expect(result.updateAvailable).toBe(true);
    });

    it('does not report update when current version is newer', async () => {
      mockGetVersion.mockReturnValue('2.0.0');
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '1.0.0' }),
      } as Response);

      const result = await checkForUpdates(false);
      expect(result.updateAvailable).toBe(false);
    });
  });
});
