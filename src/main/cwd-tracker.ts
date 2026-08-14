import * as path from 'node:path';
import Store from 'electron-store';
import log from 'electron-log/main';

const logger = log.scope('cwd-tracker');

const STORE_KEY = 'lastUsedDirectory';
const MAX_SCAN_BUFFER = 4096;

/** Minimal slice of electron-store used here (keeps tests easy to mock) */
interface StateStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

let lastUsedDirectory: string | null = null;
let stateStore: StateStore | null = null;
let storeInitAttempted = false;

function getStateStore(): StateStore | null {
  if (stateStore || storeInitAttempted) {
    return stateStore;
  }
  storeInitAttempted = true;
  try {
    stateStore = new Store<Record<string, unknown>>({
      name: 'session-state',
    }) as unknown as StateStore;
  } catch (error) {
    logger.warn('State store unavailable — last used directory kept in memory only', error);
    stateStore = null;
  }
  return stateStore;
}

/** Accept only paths that can serve as a Windows process cwd (drive-letter or UNC) */
export function isUsableWindowsDirectory(candidate: string): boolean {
  if (!candidate || candidate.includes('\0')) {
    return false;
  }
  // path.win32.isAbsolute is too lenient (treats "/foo" and "\foo" as absolute),
  // so require an explicit drive letter (C:\ or C:/) or a UNC share (\\server\share).
  return /^[a-zA-Z]:[\\/]/.test(candidate) || /^[\\/]{2}[^\\/]/.test(candidate);
}

/** Convert an OSC 7 file:// URI to a Windows path, or null when it isn't one (e.g. WSL paths) */
export function fileUriToWindowsPath(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  // Drive-letter paths arrive as /C:/Users/... — strip the leading slash
  if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
    pathname = pathname.slice(1);
  }

  const windowsPath = path.win32.normalize(pathname.replace(/\//g, '\\'));
  return isUsableWindowsDirectory(windowsPath) ? windowsPath : null;
}

function handleOscContent(content: string, onCwd: (cwd: string) => void): void {
  if (content.startsWith('9;9;')) {
    // ConEmu / Windows Terminal style: 9;9;"C:\path" (quotes optional)
    const raw = content.slice(4).trim().replace(/^"|"$/g, '');
    if (isUsableWindowsDirectory(raw)) {
      onCwd(path.win32.normalize(raw));
    }
    return;
  }
  if (content.startsWith('7;')) {
    const cwd = fileUriToWindowsPath(content.slice(2).trim());
    if (cwd) {
      onCwd(cwd);
    }
  }
}

/**
 * Stateful scanner for cwd reports (OSC 7 and OSC 9;9) inside a PTY output stream.
 * Handles escape sequences split across data chunks. Non-Windows paths (WSL) are ignored.
 */
export function createOscCwdScanner(onCwd: (cwd: string) => void): (chunk: string) => void {
  let buffer = '';

  return (chunk: string) => {
    buffer += chunk;

    let searchFrom = 0;
    for (;;) {
      const start = buffer.indexOf('\x1b]', searchFrom);
      if (start === -1) {
        // No OSC start found — keep a small tail in case ESC arrives split across chunks
        buffer = buffer.length > 1 ? buffer.slice(-1) : buffer;
        break;
      }

      const belIndex = buffer.indexOf('\x07', start + 2);
      const stIndex = buffer.indexOf('\x1b\\', start + 2);
      let end = -1;
      let terminatorLength = 1;
      if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
        end = belIndex;
      } else if (stIndex !== -1) {
        end = stIndex;
        terminatorLength = 2;
      }

      if (end === -1) {
        // Incomplete sequence — keep it for the next chunk
        buffer = buffer.slice(start);
        if (buffer.length > MAX_SCAN_BUFFER) {
          buffer = buffer.slice(-MAX_SCAN_BUFFER);
        }
        break;
      }

      handleOscContent(buffer.slice(start + 2, end), onCwd);
      searchFrom = end + terminatorLength;
      if (searchFrom >= buffer.length) {
        buffer = '';
        break;
      }
    }
  };
}

/** Record a directory as the last used one. Persists across restarts; no-op for invalid input. */
export function recordUsedDirectory(cwd: string): void {
  if (!isUsableWindowsDirectory(cwd)) {
    return;
  }
  const normalized = path.win32.normalize(cwd);
  if (normalized === lastUsedDirectory) {
    return;
  }
  lastUsedDirectory = normalized;
  try {
    getStateStore()?.set(STORE_KEY, normalized);
  } catch (error) {
    logger.warn('Failed to persist last used directory', error);
  }
}

/** Last used directory (in-memory first, then persisted value), or null when unknown */
export function getLastUsedDirectory(): string | null {
  if (lastUsedDirectory) {
    return lastUsedDirectory;
  }
  try {
    const persisted = getStateStore()?.get(STORE_KEY);
    if (typeof persisted === 'string' && isUsableWindowsDirectory(persisted)) {
      lastUsedDirectory = path.win32.normalize(persisted);
    }
  } catch (error) {
    logger.warn('Failed to read persisted last used directory', error);
  }
  return lastUsedDirectory;
}

/** @internal For test use only */
export function _resetCwdTracker(): void {
  lastUsedDirectory = null;
  stateStore = null;
  storeInitAttempted = false;
}
