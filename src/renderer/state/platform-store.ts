import type { TerminalPtyInfo } from '@shared/ipc-types';

// Fetched once at boot (see App.tsx) and cached for the lifetime of the
// renderer — never refetched per-tab or per-resize.
let cachedTerminalPtyInfo: TerminalPtyInfo | null = null;

/**
 * Fetch and cache the Windows ConPTY build-number info used by xterm.js's
 * `windowsPty` option. Must resolve before the first `Terminal` is
 * constructed. If the IPC call fails (or we're not on Windows), the cache
 * stays `null` and callers simply omit `windowsPty` — never throw.
 */
export async function initPlatformStore(): Promise<void> {
  try {
    cachedTerminalPtyInfo = await window.quakeshell.platform.getTerminalPtyInfo();
  } catch (error) {
    console.error('[platform-store] Failed to fetch terminal pty info:', error);
    cachedTerminalPtyInfo = null;
  }
}

/** Returns the cached pty info, or `null` if unavailable/non-Windows/failed. */
export function getTerminalPtyInfo(): TerminalPtyInfo | null {
  return cachedTerminalPtyInfo;
}

/** @internal For test use only */
export function _resetPlatformStoreForTesting(): void {
  cachedTerminalPtyInfo = null;
}
