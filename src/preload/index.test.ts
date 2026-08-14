import { describe, it, expect, vi } from 'vitest';

const {
  mockInvoke,
  mockExposeInMainWorld,
  mockIpcOn,
  mockIpcRemoveListener,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockExposeInMainWorld: vi.fn(),
  mockIpcOn: vi.fn(),
  mockIpcRemoveListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => mockExposeInMainWorld(...args),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    on: mockIpcOn,
    removeListener: mockIpcRemoveListener,
  },
}));

import { CHANNELS } from '../shared/channels';
import './index';

interface QuakeShellAPIUnderTest {
  platform: {
    isAcrylicSupported: () => Promise<unknown>;
    getTerminalPtyInfo: () => Promise<unknown>;
  };
  terminal: {
    onFocus: (callback: () => void) => () => void;
  };
  tab: {
    refreshEnvironment: (tabId: string) => Promise<unknown>;
    onData: (callback: (payload: { tabId: string; data: string }) => void) => () => void;
    onExited: (callback: (payload: { tabId: string; exitCode: number; signal: number }) => void) => () => void;
  };
  app: {
    getVersion: () => Promise<unknown>;
    getUpdateOperation: () => Promise<unknown>;
    checkForUpdates: () => Promise<unknown>;
    startAvailableUpdate: () => Promise<unknown>;
    openAvailableUpdateDownload: () => Promise<unknown>;
    onUpdateOperationChanged: (callback: (payload: unknown) => void) => () => void;
  };
}

describe('preload/index', () => {
  const exposedApi = mockExposeInMainWorld.mock.calls[0]?.[1] as QuakeShellAPIUnderTest;

  it('exposes the quakeshell API under the expected global key', () => {
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('quakeshell', expect.any(Object));
  });

  it('bridges platform.getTerminalPtyInfo to the new PLATFORM_GET_TERMINAL_PTY_INFO channel', () => {
    exposedApi.platform.getTerminalPtyInfo();

    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.PLATFORM_GET_TERMINAL_PTY_INFO);
  });

  it('still bridges platform.isAcrylicSupported to its existing channel', () => {
    exposedApi.platform.isAcrylicSupported();

    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.PLATFORM_IS_ACRYLIC_SUPPORTED);
  });

  it('bridges the tab-scoped environment refresh invoke without a command payload', () => {
    exposedApi.tab.refreshEnvironment('tab-1');

    expect(mockInvoke).toHaveBeenCalledWith(
      CHANNELS.TAB_REFRESH_ENVIRONMENT,
      { tabId: 'tab-1' },
    );
  });

  it('bridges version and update-operation actions through the constrained app API', () => {
    const listener = vi.fn();

    exposedApi.app.getVersion();
    exposedApi.app.getUpdateOperation();
    exposedApi.app.checkForUpdates();
    exposedApi.app.startAvailableUpdate();
    exposedApi.app.openAvailableUpdateDownload();
    const unsubscribe = exposedApi.app.onUpdateOperationChanged(listener);

    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.APP_GET_VERSION);
    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.APP_GET_UPDATE_OPERATION);
    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.APP_CHECK_FOR_UPDATES);
    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.APP_START_AVAILABLE_UPDATE);
    expect(mockInvoke).toHaveBeenCalledWith(CHANNELS.APP_OPEN_AVAILABLE_UPDATE_DOWNLOAD);
    expect(mockIpcOn).toHaveBeenCalledWith(CHANNELS.APP_UPDATE_OPERATION_CHANGED, expect.any(Function));
    unsubscribe();
  });

  it('fans out persistent terminal channels through one Electron listener per channel', () => {
    mockIpcOn.mockClear();
    mockIpcRemoveListener.mockClear();

    const dataCallbacks = Array.from({ length: 20 }, () => vi.fn());
    const exitCallbacks = Array.from({ length: 20 }, () => vi.fn());
    const focusCallbacks = Array.from({ length: 20 }, () => vi.fn());
    const unsubscribers = [
      ...dataCallbacks.map((callback) => exposedApi.tab.onData(callback)),
      ...exitCallbacks.map((callback) => exposedApi.tab.onExited(callback)),
      ...focusCallbacks.map((callback) => exposedApi.terminal.onFocus(callback)),
    ];

    expect(mockIpcOn).toHaveBeenCalledTimes(3);

    const dataListener = mockIpcOn.mock.calls.find(
      ([channel]) => channel === CHANNELS.TAB_DATA,
    )?.[1] as ((event: unknown, payload: { tabId: string; data: string }) => void) | undefined;
    const exitListener = mockIpcOn.mock.calls.find(
      ([channel]) => channel === CHANNELS.TAB_EXITED,
    )?.[1] as ((event: unknown, payload: { tabId: string; exitCode: number; signal: number }) => void) | undefined;
    const focusListener = mockIpcOn.mock.calls.find(
      ([channel]) => channel === CHANNELS.TERMINAL_FOCUS,
    )?.[1] as ((event: unknown) => void) | undefined;

    expect(dataListener).toBeTypeOf('function');
    expect(exitListener).toBeTypeOf('function');
    expect(focusListener).toBeTypeOf('function');

    dataListener?.({}, { tabId: 'tab-20', data: 'retained output' });
    exitListener?.({}, { tabId: 'tab-20', exitCode: 0, signal: 0 });
    focusListener?.({});

    for (const callback of dataCallbacks) {
      expect(callback).toHaveBeenCalledWith({ tabId: 'tab-20', data: 'retained output' });
    }
    for (const callback of exitCallbacks) {
      expect(callback).toHaveBeenCalledWith({ tabId: 'tab-20', exitCode: 0, signal: 0 });
    }
    for (const callback of focusCallbacks) {
      expect(callback).toHaveBeenCalledTimes(1);
    }

    const [firstUnsubscribe, ...remainingUnsubscribers] = unsubscribers;
    firstUnsubscribe();

    expect(mockIpcRemoveListener).not.toHaveBeenCalled();

    remainingUnsubscribers.forEach((unsubscribe) => unsubscribe());

    expect(mockIpcRemoveListener).toHaveBeenCalledTimes(3);
  });

  it('keeps duplicate callback registrations independently subscribable', () => {
    mockIpcOn.mockClear();
    mockIpcRemoveListener.mockClear();

    const callback = vi.fn();
    const firstUnsubscribe = exposedApi.terminal.onFocus(callback);
    const secondUnsubscribe = exposedApi.terminal.onFocus(callback);
    const focusListener = mockIpcOn.mock.calls[0]?.[1] as ((event: unknown) => void);

    firstUnsubscribe();
    focusListener({});

    expect(callback).toHaveBeenCalledTimes(1);
    expect(mockIpcRemoveListener).not.toHaveBeenCalled();

    secondUnsubscribe();

    expect(mockIpcRemoveListener).toHaveBeenCalledWith(CHANNELS.TERMINAL_FOCUS, focusListener);
  });

  it('removes the update-operation listener after its last subscriber unsubscribes', () => {
    mockIpcOn.mockClear();
    mockIpcRemoveListener.mockClear();

    const firstUnsubscribe = exposedApi.app.onUpdateOperationChanged(vi.fn());
    const secondUnsubscribe = exposedApi.app.onUpdateOperationChanged(vi.fn());
    const listener = mockIpcOn.mock.calls.find(
      ([channel]) => channel === CHANNELS.APP_UPDATE_OPERATION_CHANGED,
    )?.[1] as ((event: unknown, state: unknown) => void);

    expect(mockIpcOn).toHaveBeenCalledTimes(1);

    firstUnsubscribe();
    expect(mockIpcRemoveListener).not.toHaveBeenCalled();

    secondUnsubscribe();
    expect(mockIpcRemoveListener).toHaveBeenCalledWith(
      CHANNELS.APP_UPDATE_OPERATION_CHANGED,
      listener,
    );
  });
});
