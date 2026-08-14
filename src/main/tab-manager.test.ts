import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock terminal-manager
const mockPty = {
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pid: 9999,
  onData: vi.fn(),
  onExit: vi.fn(),
};

vi.mock('./terminal-manager', () => ({
  spawnPty: vi.fn(() => mockPty),
  writeToPty: vi.fn(),
  resizePty: vi.fn(),
  killPty: vi.fn(() => true),
  getEnvironmentRefreshCommand: vi.fn((shell: string) => (
    ['powershell', 'pwsh', 'cmd', 'bash'].includes(shell) ? `refresh-${shell}` : null
  )),
}));

// Mock electron
const mockSend = vi.fn();
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

// Mock cwd-tracker
const mockGetLastUsedDirectory = vi.fn<() => string | null>(() => null);
vi.mock('./cwd-tracker', () => ({
  recordUsedDirectory: vi.fn(),
  getLastUsedDirectory: (...args: unknown[]) => mockGetLastUsedDirectory(...(args as [])),
  createOscCwdScanner: vi.fn(() => vi.fn()),
}));

// Partial node:fs mock so existsSync can be controlled per test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
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

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
}));

import * as fs from 'node:fs';
import * as terminalManager from './terminal-manager';
import * as tabManager from './tab-manager';
import * as windowManager from './window-manager';
import { recordUsedDirectory } from './cwd-tracker';
import { CHANNELS } from '@shared/channels';

function createMockWindow() {
  return {
    webContents: { send: mockSend },
    isDestroyed: vi.fn(() => false),
  } as unknown as Electron.BrowserWindow;
}

function createMockConfigStore(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    defaultShell: 'powershell',
    tabs: {
      maxTabs: 10,
      colorPalette: ['#7aa2f7', '#9ece6a'],
    },
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key]),
    set: vi.fn(),
    getAll: vi.fn(() => defaults),
    getConfigPath: vi.fn(() => '/mock/config.json'),
    onDidChange: vi.fn(() => vi.fn()),
  };
}

describe('main/tab-manager', () => {
  let mockWindow: ReturnType<typeof createMockWindow>;
  let mockStore: ReturnType<typeof createMockConfigStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockGetLastUsedDirectory.mockReturnValue(null);
    tabManager._reset();
    mockWindow = createMockWindow();
    mockStore = createMockConfigStore();
  });

  describe('init()', () => {
    it('creates exactly one tab and sets it as active', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      expect(terminalManager.spawnPty).toHaveBeenCalledOnce();
      expect(tabManager.getActiveTabId()).toBe('uuid-1');

      const tabs = tabManager.listTabs();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('uuid-1');
      expect(tabs[0].shellType).toBe('powershell');
    });
  });

  describe('createTab()', () => {
    it('increments tab count and returns correct TabSessionDTO shape', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      const dto = tabManager.createTab({});
      expect(dto.id).toBe('uuid-2');
      expect(dto.shellType).toBe('powershell');
      expect(dto.color).toBe('#9ece6a'); // second color in palette
      expect(dto.createdAt).toBeGreaterThan(0);
      expect(dto).not.toHaveProperty('ptyProcess');

      expect(tabManager.listTabs()).toHaveLength(2);
    });

    it('uses provided shellType option', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      const dto = tabManager.createTab({ shellType: 'bash' });
      expect(dto.shellType).toBe('bash');
    });

    it('suppresses focus-fade for the first WSL tab launch only', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const suppressSpy = vi.spyOn(windowManager, 'suppressFocusFadeForShellLaunch').mockImplementation(() => {});

      tabManager.createTab({ shellType: 'wsl' });
      expect(suppressSpy).toHaveBeenCalledWith(1500);

      suppressSpy.mockClear();
      tabManager.createTab({ shellType: 'wsl' });
      expect(suppressSpy).not.toHaveBeenCalled();

      suppressSpy.mockRestore();
    });

    it('forwards cwd to the PTY spawn call', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      tabManager.createTab({ cwd: 'C:\\Projects\\QuakeShell' });

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        'C:\\Projects\\QuakeShell',
      );
    });

    it('records an explicit cwd as the last used directory', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      tabManager.createTab({ cwd: 'C:\\Projects\\QuakeShell' });

      expect(recordUsedDirectory).toHaveBeenCalledWith('C:\\Projects\\QuakeShell');
    });

    it('spawns without cwd when startLocation is home (default)', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      tabManager.createTab({});

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        undefined,
      );
    });

    it('uses the configured custom start directory for new tabs', async () => {
      mockStore = createMockConfigStore({
        terminal: { startLocation: 'custom', customStartDirectory: 'C:\\Projects' },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await tabManager.init(mockWindow as never, mockStore as never);

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        'C:\\Projects',
      );
    });

    it('falls back to home when the custom start directory does not exist', async () => {
      mockStore = createMockConfigStore({
        terminal: { startLocation: 'custom', customStartDirectory: 'C:\\Missing\\Dir' },
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await tabManager.init(mockWindow as never, mockStore as never);

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        undefined,
      );
    });

    it('uses the last used directory when startLocation is lastUsed', async () => {
      mockStore = createMockConfigStore({
        terminal: { startLocation: 'lastUsed', customStartDirectory: '' },
      });
      mockGetLastUsedDirectory.mockReturnValue('C:\\Projects\\LastUsed');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await tabManager.init(mockWindow as never, mockStore as never);

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        'C:\\Projects\\LastUsed',
      );
    });

    it('falls back to home when lastUsed has no recorded directory', async () => {
      mockStore = createMockConfigStore({
        terminal: { startLocation: 'lastUsed', customStartDirectory: '' },
      });
      mockGetLastUsedDirectory.mockReturnValue(null);
      await tabManager.init(mockWindow as never, mockStore as never);

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        undefined,
      );
    });

    it('explicit cwd always wins over the configured start location', async () => {
      mockStore = createMockConfigStore({
        terminal: { startLocation: 'custom', customStartDirectory: 'C:\\Projects' },
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await tabManager.init(mockWindow as never, mockStore as never);

      tabManager.createTab({ cwd: 'D:\\Explicit' });

      expect(terminalManager.spawnPty).toHaveBeenLastCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        'D:\\Explicit',
      );
    });

    it('assigns colors cycling through palette', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      // init used color index 0 → '#7aa2f7'
      const tab2 = tabManager.createTab({});
      expect(tab2.color).toBe('#9ece6a'); // index 1

      const tab3 = tabManager.createTab({});
      expect(tab3.color).toBe('#7aa2f7'); // index 2 % 2 = 0, wraps around
    });

    it('throws when tabs.size >= maxTabs', async () => {
      const limitedStore = createMockConfigStore({
        tabs: { maxTabs: 1, colorPalette: ['#7aa2f7'] },
      });
      await tabManager.init(mockWindow as never, limitedStore as never);

      // Already 1 tab from init
      expect(() => tabManager.createTab({})).toThrowError('Max tabs reached (1)');
    });
  });

  describe('closeTab()', () => {
    it('calls killPty, emits tab:closed, and removes from Map', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tab2 = tabManager.createTab({});

      tabManager.closeTab(tab2.id);

      expect(terminalManager.killPty).toHaveBeenCalledWith(mockPty);
      expect(mockSend).toHaveBeenCalledWith(
        CHANNELS.TAB_CLOSED,
        { tabId: tab2.id },
      );
      expect(tabManager.listTabs()).toHaveLength(1);
    });

    it('suppresses a delayed PTY exit after the tab has closed', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;
      const exitCallback = vi.mocked(terminalManager.spawnPty).mock.calls[0][4] as (
        exitCode: number,
        signal: number,
      ) => void;

      tabManager.closeTab(tabId);
      mockSend.mockClear();
      exitCallback(0, 0);

      expect(mockSend).not.toHaveBeenCalledWith(
        CHANNELS.TAB_EXITED,
        expect.anything(),
      );
    });

    it('suppresses delayed PTY data after the tab has closed', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;
      const dataCallback = vi.mocked(terminalManager.spawnPty).mock.calls[0][3] as (
        data: string,
      ) => void;

      tabManager.closeTab(tabId);
      mockSend.mockClear();
      dataCallback('late output');

      expect(mockSend).not.toHaveBeenCalledWith(
        CHANNELS.TAB_DATA,
        { tabId, data: 'late output' },
      );
    });

    it('throws for non-existent tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      expect(() => tabManager.closeTab('non-existent')).toThrowError('Tab not found: non-existent');
    });

    it('updates activeTabId to adjacent tab when closing active tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const firstTabId = tabManager.getActiveTabId()!;
      const tab2 = tabManager.createTab({});

      // Active is now tab2
      expect(tabManager.getActiveTabId()).toBe(tab2.id);

      // Close active tab2 → should fall back to firstTab
      tabManager.closeTab(tab2.id);
      expect(tabManager.getActiveTabId()).toBe(firstTabId);
    });

    it('creates a fresh tab when closing the last tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;

      tabManager.closeTab(tabId);
      // Last-tab-closed behaviour: a new default tab is auto-created
      const newActiveId = tabManager.getActiveTabId();
      expect(newActiveId).not.toBeNull();
      expect(newActiveId).not.toBe(tabId);
      expect(tabManager.listTabs()).toHaveLength(1);
    });
  });

  describe('setActiveTab()', () => {
    it('updates activeTabId and broadcasts tab:active-changed', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tab2 = tabManager.createTab({});

      mockSend.mockClear();
      tabManager.setActiveTab(tab2.id);

      expect(tabManager.getActiveTabId()).toBe(tab2.id);
      expect(mockSend).toHaveBeenCalledWith(
        CHANNELS.TAB_ACTIVE_CHANGED,
        { tabId: tab2.id },
      );
    });
  });

  describe('renameTab()', () => {
    it('sets manualName and broadcasts tab:renamed', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;

      tabManager.renameTab(tabId, 'My Terminal');

      const tabs = tabManager.listTabs();
      expect(tabs[0].manualName).toBe('My Terminal');
      expect(mockSend).toHaveBeenCalledWith(
        CHANNELS.TAB_RENAMED,
        { tabId, name: 'My Terminal' },
      );
    });

    it('throws for non-existent tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      expect(() => tabManager.renameTab('bad-id', 'x')).toThrowError('Tab not found: bad-id');
    });
  });

  describe('listTabs()', () => {
    it('returns DTOs without ptyProcess field', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      tabManager.createTab({});

      const tabs = tabManager.listTabs();
      expect(tabs).toHaveLength(2);
      for (const tab of tabs) {
        expect(tab).toHaveProperty('id');
        expect(tab).toHaveProperty('shellType');
        expect(tab).toHaveProperty('color');
        expect(tab).toHaveProperty('createdAt');
        expect(tab).not.toHaveProperty('ptyProcess');
      }
    });
  });

  describe('reorderTabs()', () => {
    it('reorders tabs in list order without changing the active tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tab2 = tabManager.createTab({});
      const tab3 = tabManager.createTab({});

      const reordered = tabManager.reorderTabs([tab3.id, 'uuid-1', tab2.id]);

      expect(reordered.map((tab) => tab.id)).toEqual([tab3.id, 'uuid-1', tab2.id]);
      expect(tabManager.listTabs().map((tab) => tab.id)).toEqual([tab3.id, 'uuid-1', tab2.id]);
      expect(tabManager.getActiveTabId()).toBe(tab3.id);
    });

    it('rejects invalid reorder payloads', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tab2 = tabManager.createTab({});

      expect(() => tabManager.reorderTabs(['uuid-1'])).toThrowError(
        'Tab reorder payload did not match current tab count',
      );
      expect(() => tabManager.reorderTabs(['uuid-1', 'uuid-1'])).toThrowError(
        'Duplicate tab in reorder payload: uuid-1',
      );
      expect(() => tabManager.reorderTabs(['uuid-1', 'missing-tab'])).toThrowError(
        'Tab not found: missing-tab',
      );
      expect(tabManager.listTabs().map((tab) => tab.id)).toEqual(['uuid-1', tab2.id]);
    });
  });

  describe('writeToTab()', () => {
    it('calls terminalManager.writeToPty with the session pty', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;

      tabManager.writeToTab(tabId, 'hello');
      expect(terminalManager.writeToPty).toHaveBeenCalledWith(mockPty, 'hello');
    });

    it('throws for non-existent tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      expect(() => tabManager.writeToTab('bad', 'data')).toThrowError('Tab not found: bad');
    });
  });

  describe('resizeTab()', () => {
    it('calls terminalManager.resizePty with the session pty', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;

      tabManager.resizeTab(tabId, 120, 40);
      expect(terminalManager.resizePty).toHaveBeenCalledWith(mockPty, 120, 40);
    });

    it('throws for non-existent tab', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      expect(() => tabManager.resizeTab('bad', 80, 24)).toThrowError('Tab not found: bad');
    });
  });

  describe('refreshEnvironment()', () => {
    it('writes the trusted command and Enter to the exact running PTY without changing lifecycle state', async () => {
      const firstPty = { ...mockPty, pid: 10000 };
      const focusedPty = { ...mockPty, pid: 10001 };
      vi.mocked(terminalManager.spawnPty)
        .mockReturnValueOnce(firstPty)
        .mockReturnValueOnce(focusedPty);

      await tabManager.init(mockWindow as never, mockStore as never);
      const focusedTab = tabManager.createTab({ shellType: 'cmd', cwd: 'C:\\Projects\\Focused' });
      tabManager.renameTab(focusedTab.id, 'Focused Terminal');
      tabManager.resizeTab(focusedTab.id, 120, 40);
      const tabsBeforeRefresh = tabManager.listTabs();
      const activeTabBeforeRefresh = tabManager.getActiveTabId();
      mockSend.mockClear();
      vi.mocked(terminalManager.spawnPty).mockClear();
      vi.mocked(terminalManager.killPty).mockClear();
      vi.mocked(terminalManager.writeToPty).mockClear();

      tabManager.refreshEnvironment(focusedTab.id);

      expect(terminalManager.getEnvironmentRefreshCommand).toHaveBeenCalledWith('cmd');
      expect(terminalManager.writeToPty).toHaveBeenCalledWith(focusedPty, 'refresh-cmd\r');
      expect(terminalManager.spawnPty).not.toHaveBeenCalled();
      expect(terminalManager.killPty).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      expect(tabManager.listTabs()).toEqual(tabsBeforeRefresh);
      expect(tabManager.getActiveTabId()).toBe(activeTabBeforeRefresh);
    });

    it('rejects a missing tab before looking up a command or writing to a PTY', () => {
      expect(() => tabManager.refreshEnvironment('missing-tab')).toThrow('Tab not found: missing-tab');
      expect(terminalManager.getEnvironmentRefreshCommand).not.toHaveBeenCalled();
      expect(terminalManager.writeToPty).not.toHaveBeenCalled();
    });

    it('rejects pending and exited tabs without mutating their PTYs or status', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const pendingTab = tabManager.createTab({ deferred: true });
      const exitedTab = tabManager.createTab({});
      const exitCallback = vi.mocked(terminalManager.spawnPty).mock.calls[1][4] as (
        exitCode: number,
        signal: number,
      ) => void;
      exitCallback(0, 0);
      vi.mocked(terminalManager.writeToPty).mockClear();
      vi.mocked(terminalManager.killPty).mockClear();

      expect(() => tabManager.refreshEnvironment(pendingTab.id)).toThrow(
        'Terminal environment refresh is only available for a running tab',
      );
      expect(() => tabManager.refreshEnvironment(exitedTab.id)).toThrow(
        'Terminal environment refresh is only available for a running tab',
      );
      expect(terminalManager.writeToPty).not.toHaveBeenCalled();
      expect(terminalManager.killPty).not.toHaveBeenCalled();
      expect(tabManager.listTabs()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: pendingTab.id, status: 'pending' }),
        expect.objectContaining({ id: exitedTab.id, status: 'exited' }),
      ]));
    });

    it('rejects WSL and custom shell tabs without sending terminal input', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const wslTab = tabManager.createTab({ shellType: 'wsl' });
      const customShellTab = tabManager.createTab({ shellType: 'C:\\Tools\\shell.exe' });
      vi.mocked(terminalManager.writeToPty).mockClear();

      expect(() => tabManager.refreshEnvironment(wslTab.id)).toThrow(
        'Terminal environment refresh is unavailable for this shell',
      );
      expect(() => tabManager.refreshEnvironment(customShellTab.id)).toThrow(
        'Terminal environment refresh is unavailable for this shell',
      );
      expect(terminalManager.writeToPty).not.toHaveBeenCalled();
    });

    it('propagates a failed PTY write without changing tab state', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const tabId = tabManager.getActiveTabId()!;
      const tabsBeforeRefresh = tabManager.listTabs();
      vi.mocked(terminalManager.writeToPty).mockImplementationOnce(() => {
        throw new Error('PTY write failed');
      });
      vi.mocked(terminalManager.killPty).mockClear();

      expect(() => tabManager.refreshEnvironment(tabId)).toThrow('PTY write failed');
      expect(tabManager.listTabs()).toEqual(tabsBeforeRefresh);
      expect(terminalManager.spawnPty).toHaveBeenCalledTimes(1);
      expect(terminalManager.killPty).not.toHaveBeenCalled();
    });
  });

  describe('spawnTab()', () => {
    it('preserves cwd for deferred tabs when the shell starts later', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);

      const deferredTab = tabManager.createTab({ cwd: 'C:\\Projects\\Deferred', deferred: true });
      vi.mocked(terminalManager.spawnPty).mockClear();

      tabManager.spawnTab(deferredTab.id);

      expect(terminalManager.spawnPty).toHaveBeenCalledWith(
        'powershell',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        'C:\\Projects\\Deferred',
      );
    });
    
    it('suppresses focus-fade when the first WSL launch happens via deferred spawn', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      const suppressSpy = vi.spyOn(windowManager, 'suppressFocusFadeForShellLaunch').mockImplementation(() => {});

      const deferredTab = tabManager.createTab({ shellType: 'wsl', deferred: true });
      suppressSpy.mockClear();

      tabManager.spawnTab(deferredTab.id);

      expect(suppressSpy).toHaveBeenCalledWith(1500);
      suppressSpy.mockRestore();
    });
  });

  describe('destroyAllTabs()', () => {
    it('calls killPty for every running tab PTY', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      tabManager.createTab({});
      tabManager.createTab({});

      vi.mocked(terminalManager.killPty).mockClear();
      tabManager.destroyAllTabs();

      // 3 tabs total (1 from init + 2 created), each with a ptyProcess
      expect(terminalManager.killPty).toHaveBeenCalledTimes(3);
    });

    it('does not throw when there are no tabs', () => {
      expect(() => tabManager.destroyAllTabs()).not.toThrow();
    });

    it('skips deferred tabs with no PTY', async () => {
      await tabManager.init(mockWindow as never, mockStore as never);
      tabManager.createTab({ deferred: true });

      vi.mocked(terminalManager.killPty).mockClear();
      tabManager.destroyAllTabs();

      // Only 1 running tab (from init), deferred tab has null ptyProcess
      expect(terminalManager.killPty).toHaveBeenCalledTimes(1);
    });
  });
});
