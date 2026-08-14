import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configDefaults } from '@shared/config-schema';

// --- Mock electron-store with onDidAnyChange ---
let onDidAnyChangeCallback: ((newVal: Record<string, unknown>, oldVal: Record<string, unknown>) => void) | null = null;
const mockStoreData: Record<string, unknown> = {};

vi.mock('electron-store', () => ({
  default: class MockStore {
    store: Record<string, unknown>;
    constructor() {
      this.store = mockStoreData;
    }
    get(key?: string) {
      if (key === undefined) return this.store;
      return this.store[key];
    }
    set(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'object') {
        Object.assign(this.store, key);
      } else {
        this.store[key] = value;
      }
    }
    onDidAnyChange(callback: (newVal: Record<string, unknown>, oldVal: Record<string, unknown>) => void) {
      onDidAnyChangeCallback = callback;
      return () => { onDidAnyChangeCallback = null; };
    }
  },
}));

// --- Mock BrowserWindow with event support ---
const mockBounds = { x: 0, y: -300, width: 1920, height: 300 };
const mockSetBounds = vi.fn((b: Record<string, number>) => {
  Object.assign(mockBounds, b);
});
const mockSetOpacity = vi.fn();
const mockFocus = vi.fn();
const mockShowInactive = vi.fn();
const mockHide = vi.fn();
const windowEventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

vi.mock('electron', () => {
  function MockBrowserWindow() {
    for (const key of Object.keys(windowEventHandlers)) {
      delete windowEventHandlers[key];
    }
    return {
      setBounds: mockSetBounds,
      getBounds: vi.fn(() => ({ ...mockBounds })),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      focus: mockFocus,
      blur: vi.fn(),
      hide: mockHide,
      showInactive: mockShowInactive,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (!windowEventHandlers[event]) windowEventHandlers[event] = [];
        windowEventHandlers[event].push(handler);
      },
      removeListener: (event: string, handler: (...args: unknown[]) => void) => {
        if (windowEventHandlers[event]) {
          windowEventHandlers[event] = windowEventHandlers[event].filter(h => h !== handler);
        }
      },
      setOpacity: mockSetOpacity,
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn(), openDevTools: vi.fn() },
    };
  }
  return {
    BrowserWindow: MockBrowserWindow,
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      })),
      getCursorScreenPoint: vi.fn(() => ({ x: 960, y: 540 })),
      getPrimaryDisplay: vi.fn(() => ({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      })),
      on: vi.fn(),
    },
    app: { isPackaged: true },
    nativeTheme: {
      shouldUseHighContrastColors: false,
      on: vi.fn(),
    },
  };
});

const mockLoggerInstance = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('electron-log/main', () => ({
  default: {
    scope: vi.fn(() => mockLoggerInstance),
  },
}));

declare global {
  /* eslint-disable no-var */
  var MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  var MAIN_WINDOW_VITE_NAME: string;
}
globalThis.MAIN_WINDOW_VITE_DEV_SERVER_URL = 'http://localhost:5173';
globalThis.MAIN_WINDOW_VITE_NAME = 'main_window';

import { createConfigStore } from './config-store';
import { createWindow, show, isVisible, setupFocusFade, teardownFocusFade, setOpacity, _reset } from './window-manager';

function simulateWindowEvent(event: string): void {
  if (windowEventHandlers[event]) {
    for (const handler of [...windowEventHandlers[event]]) {
      handler();
    }
  }
}

describe('integration: opacity and focus-fade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _reset();
    onDidAnyChangeCallback = null;
    for (const key of Object.keys(mockStoreData)) {
      delete mockStoreData[key];
    }
    for (const key of Object.keys(windowEventHandlers)) {
      delete windowEventHandlers[key];
    }
    mockBounds.x = 0;
    mockBounds.y = -300;
    mockBounds.width = 1920;
    mockBounds.height = 300;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies initial opacity on startup and updates via hot-reload (AC: #1, #2)', async () => {
    // Create config store with opacity 0.5
    const configStore = createConfigStore();
    configStore.set('opacity', 0.5);

    // Create window — should apply opacity from config
    createWindow(configStore as never);
    expect(mockSetOpacity).toHaveBeenCalledWith(0.5);

    // Show window
    const showPromise = show();
    vi.advanceTimersByTime(250);
    await showPromise;

    // Opacity should be re-applied after show
    expect(mockSetOpacity).toHaveBeenLastCalledWith(0.5);

    // Simulate hot-reload: change opacity to 0.9
    mockSetOpacity.mockClear();
    onDidAnyChangeCallback?.({ ...configDefaults, opacity: 0.9 }, {});

    // Config store should have new value
    expect(configStore.get('opacity')).toBe(0.9);

    // External call to setOpacity (as ipc-handlers would do)
    setOpacity(0.9);
    expect(mockSetOpacity).toHaveBeenCalledWith(0.9);
  });

  it('full focus-fade cycle: show → blur → 300ms → hidden → toggle → shown (AC: #3)', async () => {
    const configStore = createConfigStore();
    createWindow(configStore as never);

    // Show terminal
    const showPromise = show();
    vi.advanceTimersByTime(250);
    await showPromise;
    expect(isVisible()).toBe(true);

    // Enable focus-fade
    setupFocusFade();

    // Blur (click away)
    simulateWindowEvent('blur');

    // Wait 300ms grace period
    vi.advanceTimersByTime(300);

    // Hide animation runs
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(isVisible()).toBe(false);
    expect(mockHide).toHaveBeenCalledTimes(1);

    // Show via toggle
    const show2 = show();
    vi.advanceTimersByTime(250);
    await show2;

    expect(isVisible()).toBe(true);

    // Verify opacity is still correct
    expect(mockSetOpacity).toHaveBeenLastCalledWith(0.85);
  });

  it('focus-fade grace period cancellation: blur → focus within 200ms → visible (AC: #4)', async () => {
    const configStore = createConfigStore();
    createWindow(configStore as never);

    const showPromise = show();
    vi.advanceTimersByTime(250);
    await showPromise;

    setupFocusFade();

    // Blur
    simulateWindowEvent('blur');
    vi.advanceTimersByTime(200);

    // Return focus
    simulateWindowEvent('focus');

    // Advance past grace period
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(isVisible()).toBe(true);
  });

  it('focus-fade disabled: blur does not hide terminal (AC: #5)', async () => {
    const configStore = createConfigStore();
    configStore.set('focusFade', false);
    createWindow(configStore as never);

    const showPromise = show();
    vi.advanceTimersByTime(250);
    await showPromise;

    // Don't setup focus-fade since it's disabled
    simulateWindowEvent('blur');
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(isVisible()).toBe(true);
  });

  it('focus-fade dynamic toggle via hot-reload: true→false→true (AC: #6)', async () => {
    const configStore = createConfigStore();
    createWindow(configStore as never);

    const showPromise = show();
    vi.advanceTimersByTime(250);
    await showPromise;

    // Start with focus-fade enabled
    setupFocusFade();

    // Disable focus-fade (simulating hot-reload)
    teardownFocusFade();

    // Blur should NOT hide
    simulateWindowEvent('blur');
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();
    expect(isVisible()).toBe(true);

    // Re-enable focus-fade
    setupFocusFade();

    // Blur should now hide after grace period
    simulateWindowEvent('blur');
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(isVisible()).toBe(false);
    expect(mockHide).toHaveBeenCalledTimes(1);
  });

  it('config hot-reload cycle: opacity change triggers immediate update', () => {
    const configStore = createConfigStore();
    createWindow(configStore as never);
    mockSetOpacity.mockClear();

    // Register change listener (as ipc-handlers does)
    configStore.onDidChange((key, value) => {
      if (key === 'opacity') {
        setOpacity(value as number);
      }
    });

    // Simulate external config file change
    onDidAnyChangeCallback?.({ ...configDefaults, opacity: 0.3 }, {});

    expect(configStore.get('opacity')).toBe(0.3);
    expect(mockSetOpacity).toHaveBeenCalledWith(0.3);
  });
});
