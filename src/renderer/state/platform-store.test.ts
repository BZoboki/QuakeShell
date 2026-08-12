// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTerminalPtyInfo = vi.fn();

// Mock window.quakeshell before importing the module
Object.defineProperty(window, 'quakeshell', {
  value: {
    platform: {
      getTerminalPtyInfo: mockGetTerminalPtyInfo,
    },
  },
  writable: true,
});

import { getTerminalPtyInfo, initPlatformStore, _resetPlatformStoreForTesting } from './platform-store';

describe('renderer/state/platform-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPlatformStoreForTesting();
  });

  it('returns null before initPlatformStore has resolved', () => {
    expect(getTerminalPtyInfo()).toBeNull();
  });

  it('caches the ConPTY info returned by the main process on Windows', async () => {
    mockGetTerminalPtyInfo.mockResolvedValueOnce({ backend: 'conpty', buildNumber: 22621 });

    await initPlatformStore();

    expect(getTerminalPtyInfo()).toEqual({ backend: 'conpty', buildNumber: 22621 });
  });

  it('caches null on macOS/Linux, where the main process returns null', async () => {
    mockGetTerminalPtyInfo.mockResolvedValueOnce(null);

    await initPlatformStore();

    expect(getTerminalPtyInfo()).toBeNull();
  });

  it('falls back to null without throwing when the IPC call rejects', async () => {
    mockGetTerminalPtyInfo.mockRejectedValueOnce(new Error('IPC unavailable'));

    await expect(initPlatformStore()).resolves.toBeUndefined();
    expect(getTerminalPtyInfo()).toBeNull();
  });
});
