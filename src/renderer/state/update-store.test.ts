// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type UpdateOperationState = {
  phase: 'checking' | 'available' | 'installing' | 'ready-to-restart' | 'up-to-date' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  action: 'install' | 'download' | 'restart' | null;
  error?: string;
};

let updateOperationListener: ((state: UpdateOperationState | null) => void) | null = null;
const mockOperationUnsubscribe = vi.fn();
const mockWindowUnsubscribe = vi.fn();

describe('renderer/update-store operation state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    updateOperationListener = null;

    Object.defineProperty(window, 'quakeshell', {
      configurable: true,
      writable: true,
      value: {
        window: {
          onStateChanged: vi.fn(() => mockWindowUnsubscribe),
        },
        app: {
          getVersion: vi.fn(() => Promise.resolve('1.0.19')),
          getUpdateOperation: vi.fn(() => Promise.resolve({
            phase: 'available',
            currentVersion: '1.0.19',
            latestVersion: '1.0.20',
            action: 'install',
          })),
          onUpdateOperationChanged: vi.fn((callback: (state: UpdateOperationState | null) => void) => {
            updateOperationListener = callback;
            return mockOperationUnsubscribe;
          }),
        },
      },
    });
  });

  afterEach(() => {
    window.dispatchEvent(new Event('unload'));
  });

  it('loads the version and update state, updates from events, and unsubscribes on unload', async () => {
    const store = await import('./update-store');

    await store.initUpdateOperationStore();

    expect(store.installedVersion.value).toBe('1.0.19');
    expect(store.updateOperation.value).toEqual({
      phase: 'available',
      currentVersion: '1.0.19',
      latestVersion: '1.0.20',
      action: 'install',
    });

    updateOperationListener?.({
      phase: 'ready-to-restart',
      currentVersion: '1.0.19',
      latestVersion: '1.0.20',
      action: 'restart',
    });

    expect(store.updateOperation.value?.phase).toBe('ready-to-restart');
    expect(store.pendingUpdate.value).toEqual({
      version: '1.0.20',
      source: 'background-install',
    });

    window.dispatchEvent(new Event('unload'));
    expect(mockOperationUnsubscribe).toHaveBeenCalledTimes(1);
  });
});