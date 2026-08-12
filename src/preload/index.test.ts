import { describe, it, expect, vi } from 'vitest';

const { mockInvoke, mockExposeInMainWorld } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockExposeInMainWorld: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (...args: unknown[]) => mockExposeInMainWorld(...args),
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => mockInvoke(...args),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import { CHANNELS } from '../shared/channels';
import './index';

interface QuakeShellPlatformAPIUnderTest {
  isAcrylicSupported: () => Promise<unknown>;
  getTerminalPtyInfo: () => Promise<unknown>;
}

describe('preload/index', () => {
  const exposedApi = mockExposeInMainWorld.mock.calls[0]?.[1] as {
    platform: QuakeShellPlatformAPIUnderTest;
  };

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
});
