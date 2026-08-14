import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store before importing cwd-tracker
const mockStateStore: Record<string, unknown> = {};
const mockSet = vi.fn((key: string, value: unknown) => {
  mockStateStore[key] = value;
});

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key?: string) {
      if (key === undefined) return mockStateStore;
      return mockStateStore[key];
    }
    set(key: string, value: unknown) {
      mockSet(key, value);
    }
  },
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

import {
  createOscCwdScanner,
  fileUriToWindowsPath,
  getLastUsedDirectory,
  isUsableWindowsDirectory,
  recordUsedDirectory,
  _resetCwdTracker,
} from './cwd-tracker';

describe('main/cwd-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockStateStore)) {
      delete mockStateStore[key];
    }
    _resetCwdTracker();
  });

  describe('isUsableWindowsDirectory()', () => {
    it('accepts drive-letter and UNC paths', () => {
      expect(isUsableWindowsDirectory('C:\\Users\\test')).toBe(true);
      expect(isUsableWindowsDirectory('\\\\server\\share')).toBe(true);
    });

    it('rejects empty, null-byte, and non-Windows paths', () => {
      expect(isUsableWindowsDirectory('')).toBe(false);
      expect(isUsableWindowsDirectory('bad\0path')).toBe(false);
      expect(isUsableWindowsDirectory('/home/user')).toBe(false);
      expect(isUsableWindowsDirectory('relative\\path')).toBe(false);
    });
  });

  describe('fileUriToWindowsPath()', () => {
    it('converts a drive-letter file URI to a Windows path', () => {
      expect(fileUriToWindowsPath('file://DESKTOP-1/C:/Users/test')).toBe('C:\\Users\\test');
      expect(fileUriToWindowsPath('file:///C:/Users/test')).toBe('C:\\Users\\test');
    });

    it('decodes percent-encoded characters', () => {
      expect(fileUriToWindowsPath('file://HOST/C:/Users/test%20user')).toBe('C:\\Users\\test user');
    });

    it('rejects non-Windows paths (e.g. WSL) and non-file URIs', () => {
      expect(fileUriToWindowsPath('file://wsl.localhost/Ubuntu/home/user')).toBeNull();
      expect(fileUriToWindowsPath('file:///home/user')).toBeNull();
      expect(fileUriToWindowsPath('https://example.com/C:/x')).toBeNull();
      expect(fileUriToWindowsPath('not a uri')).toBeNull();
    });
  });

  describe('createOscCwdScanner()', () => {
    it('detects OSC 9;9 reports terminated by BEL', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('some output \x1b]9;9;"C:\\Projects\\QuakeShell"\x07 more output');

      expect(onCwd).toHaveBeenCalledWith('C:\\Projects\\QuakeShell');
    });

    it('detects OSC 9;9 reports terminated by ST and without quotes', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('\x1b]9;9;D:\\Work\x1b\\');

      expect(onCwd).toHaveBeenCalledWith('D:\\Work');
    });

    it('detects OSC 7 file URIs', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('\x1b]7;file://DESKTOP-1/C:/Users/test\x07');

      expect(onCwd).toHaveBeenCalledWith('C:\\Users\\test');
    });

    it('handles sequences split across chunks', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('prompt \x1b]9;9;"C:\\Proj');
      expect(onCwd).not.toHaveBeenCalled();

      scan('ects"\x07rest');
      expect(onCwd).toHaveBeenCalledWith('C:\\Projects');
    });

    it('handles a chunk ending with a lone ESC', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('output\x1b');
      scan(']7;file:///C:/Users/test\x07');

      expect(onCwd).toHaveBeenCalledWith('C:\\Users\\test');
    });

    it('ignores WSL paths and malformed sequences', () => {
      const onCwd = vi.fn();
      const scan = createOscCwdScanner(onCwd);

      scan('\x1b]7;file://wsl.localhost/Ubuntu/home/user\x07');
      scan('\x1b]9;9;"/home/user"\x07');
      scan('\x1b]0;window title\x07');

      expect(onCwd).not.toHaveBeenCalled();
    });
  });

  describe('recordUsedDirectory() / getLastUsedDirectory()', () => {
    it('records and returns the normalized directory', () => {
      recordUsedDirectory('C:/Projects/QuakeShell');

      expect(getLastUsedDirectory()).toBe('C:\\Projects\\QuakeShell');
      expect(mockSet).toHaveBeenCalledWith('lastUsedDirectory', 'C:\\Projects\\QuakeShell');
    });

    it('does not persist the same directory twice in a row', () => {
      recordUsedDirectory('C:\\Projects');
      recordUsedDirectory('C:\\Projects');

      expect(mockSet).toHaveBeenCalledTimes(1);
    });

    it('ignores unusable directories', () => {
      recordUsedDirectory('/home/user');
      recordUsedDirectory('');

      expect(getLastUsedDirectory()).toBeNull();
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('restores the persisted directory across resets (restart simulation)', () => {
      recordUsedDirectory('C:\\Projects');
      _resetCwdTracker();

      expect(getLastUsedDirectory()).toBe('C:\\Projects');
    });
  });
});
