import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// --- Mocks ---

const mockBounds = { x: 0, y: -312, width: 1920, height: 312 };
const mockSetBounds = vi.fn((b: Record<string, number>) => {
  Object.assign(mockBounds, b);
});
const mockGetBounds = vi.fn(() => ({ ...mockBounds }));
const mockLoadURL = vi.fn();
const mockLoadFile = vi.fn();
let mockWindowFocused = false;
const mockFocus = vi.fn(() => {
  mockWindowFocused = true;
});
const mockShow = vi.fn();
const mockHide = vi.fn();
const mockBlur = vi.fn(() => {
  mockWindowFocused = false;
});
const mockClose = vi.fn();
const mockShowInactive = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();
const mockSetOpacity = vi.fn();
const mockIsFocused = vi.fn(() => mockWindowFocused);
let mockWindowDestroyed = false;
const mockIsDestroyed = vi.fn(() => mockWindowDestroyed);
const mockWebContents = { send: vi.fn(), openDevTools: vi.fn() };
let lastBrowserWindowArgs: unknown = null;
const createdBrowserWindowArgs: unknown[] = [];

// Track registered event handlers for simulation
const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

vi.mock('electron', () => {
  function MockBrowserWindow(opts: unknown) {
    lastBrowserWindowArgs = opts;
    createdBrowserWindowArgs.push(opts);
    return {
      setBounds: mockSetBounds,
      getBounds: mockGetBounds,
      loadURL: mockLoadURL,
      loadFile: mockLoadFile,
      focus: mockFocus,
      show: mockShow,
      blur: mockBlur,
      hide: mockHide,
      close: () => {
        mockClose();
        if (eventHandlers.closed) {
          for (const handler of [...eventHandlers.closed]) {
            handler();
          }
        }
      },
      showInactive: mockShowInactive,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        mockOn(event, handler);
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
      },
      removeListener: (event: string, handler: (...args: unknown[]) => void) => {
        mockRemoveListener(event, handler);
        if (eventHandlers[event]) {
          eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
        }
      },
      setOpacity: mockSetOpacity,
      isFocused: mockIsFocused,
      isDestroyed: mockIsDestroyed,
      webContents: mockWebContents,
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
      getDisplayMatching: vi.fn(() => ({
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      })),
      on: vi.fn(),
    },
    app: {
      isPackaged: false,
    },
    nativeTheme: {
      shouldUseHighContrastColors: false,
      on: vi.fn(),
    },
  };
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

// Declare Vite globals for the module
declare global {
  /* eslint-disable no-var */
  var MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
  var MAIN_WINDOW_VITE_NAME: string;
}
globalThis.MAIN_WINDOW_VITE_DEV_SERVER_URL = 'http://localhost:5173';
globalThis.MAIN_WINDOW_VITE_NAME = 'main_window';

import {
  createWindow,
  toggle,
  show,
  hide,
  openSettingsWindow,
  isVisible,
  getWindow,
  getSettingsWindow,
  setQuitting,
  setOpacity,
  onStateChange,
  setupFocusFade,
  suppressFocusFadeForShellLaunch,
  teardownFocusFade,
  isAnimating,
  setReducedMotion,
  getReducedMotion,
  startResizeDrag,
  stopResizeDrag,
  resetWindowHeight,
  resolveRendererEntryPath,
  _reset,
} from './window-manager';
import { screen, nativeTheme } from 'electron';

function simulateEvent(event: string): void {
  if (event === 'focus') {
    mockWindowFocused = true;
  } else if (event === 'blur') {
    mockWindowFocused = false;
  }

  if (eventHandlers[event]) {
    for (const handler of [...eventHandlers[event]]) {
      handler();
    }
  }
}

function createMockConfigStore() {
  return {
    get: vi.fn((key: string) => {
      const config: Record<string, unknown> = {
        hotkey: 'Ctrl+Shift+Q',
        dropHeight: 30,
        opacity: 0.85,
        defaultShell: 'powershell',
        animationSpeed: 200,
      };
      return config[key];
    }),
    set: vi.fn(),
    getAll: vi.fn(() => ({
      hotkey: 'Ctrl+Shift+Q',
      dropHeight: 30,
      opacity: 0.85,
      defaultShell: 'powershell',
      focusFade: true,
      animationSpeed: 200,
      fontSize: 14,
      fontFamily: 'Cascadia Code',
      autostart: true,
      firstRun: true,
    })),
    onDidChange: vi.fn(() => vi.fn()),
  };
}

describe('main/window-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _reset();
    lastBrowserWindowArgs = null;
    createdBrowserWindowArgs.length = 0;
    mockWindowFocused = false;
    mockWindowDestroyed = false;
    mockBounds.x = 0;
    mockBounds.y = -312;
    mockBounds.width = 1920;
    mockBounds.height = 312;
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createWindow()', () => {
    it('creates BrowserWindow with correct security options', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const opts = lastBrowserWindowArgs as Record<string, unknown>;
      expect(opts).toMatchObject({
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        show: false,
      });
      const prefs = opts.webPreferences as Record<string, unknown>;
      expect(prefs.contextIsolation).toBe(true);
      expect(prefs.sandbox).toBe(true);
      expect(prefs.nodeIntegration).toBe(false);
      expect(prefs.webviewTag).toBe(false);
    });

    it('calculates dimensions from screen and config dropHeight', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const opts = lastBrowserWindowArgs as Record<string, unknown>;
      // 1920 wide, 1040 workArea * 30% = 312 height
      expect(opts.width).toBe(1920);
      expect(opts.height).toBe(312);
      expect(opts.x).toBe(0);
      expect(opts.y).toBe(-312);
    });

    it('returns the BrowserWindow instance', () => {
      const configStore = createMockConfigStore();
      const win = createWindow(configStore as never);
      expect(win).toBeDefined();
      expect(getWindow()).toBe(win);
    });

    it('intercepts close event to hide instead of destroy', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      // Find the 'close' handler registered via window.on
      const closeCall = mockOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'close',
      );
      expect(closeCall).toBeDefined();
    });

    it('resolves the source renderer build path when the default packaged location is absent', () => {
      const resolvedPath = resolveRendererEntryPath((candidatePath) =>
        candidatePath === path.join(
          __dirname,
          '..',
          '..',
          'src',
          'renderer',
          '.vite',
          'renderer',
          'main_window',
          'index.html',
        ),
      );

      expect(resolvedPath).toBe(path.join(
        __dirname,
        '..',
        '..',
        'src',
        'renderer',
        '.vite',
        'renderer',
        'main_window',
        'index.html',
      ));
    });
  });

  describe('openSettingsWindow()', () => {
    it('creates a centered fixed-size settings window with the settings view route', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      await openSettingsWindow('keyboard');

      expect(createdBrowserWindowArgs).toHaveLength(2);
      expect(getSettingsWindow()).toBeDefined();

      const settingsWindowArgs = createdBrowserWindowArgs[1] as Record<string, unknown>;
      expect(settingsWindowArgs).toMatchObject({
        title: 'QuakeShell Settings',
        width: 920,
        height: 760,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
      });
      expect(mockLoadURL).toHaveBeenCalledWith('http://localhost:5173/?view=settings&tab=keyboard');
      expect(mockShow).toHaveBeenCalled();
      expect(mockFocus).toHaveBeenCalled();
    });

    it('closes the settings window when the main shell hides', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      await openSettingsWindow();

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      mockClose.mockClear();

      const hidePromise = hide();
      vi.advanceTimersByTime(200);
      await hidePromise;

      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('toggle()', () => {
    it('shows when hidden and hides when visible', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      expect(isVisible()).toBe(false);

      // Start show animation
      const showPromise = toggle();
      // Advance time past animation duration
      vi.advanceTimersByTime(250);
      await showPromise;

      expect(isVisible()).toBe(true);

      // Start hide animation
      const hidePromise = toggle();
      vi.advanceTimersByTime(200);
      await hidePromise;

      expect(isVisible()).toBe(false);
    });
  });

  describe('hide()', () => {
    it('does not destroy the window (UX-DR29)', async () => {
      const configStore = createMockConfigStore();
      const win = createWindow(configStore as never);

      // Show first
      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      // Hide
      const hidePromise = hide();
      vi.advanceTimersByTime(200);
      await hidePromise;

      // Window should still exist
      expect(getWindow()).toBe(win);
      expect(isVisible()).toBe(false);
    });
  });

  describe('state change callback', () => {
    it('fires callback when visibility changes', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const callback = vi.fn();
      onStateChange(callback);

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;
      expect(callback).toHaveBeenCalledWith(true);

      const hidePromise = hide();
      vi.advanceTimersByTime(200);
      await hidePromise;
      expect(callback).toHaveBeenCalledWith(false);
    });
  });

  describe('setOpacity()', () => {
    it('calls BrowserWindow.setOpacity with correct value', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      setOpacity(0.5);
      expect(mockSetOpacity).toHaveBeenCalledWith(0.5);
    });

    it('does nothing when no window exists', () => {
      setOpacity(0.5);
      expect(mockSetOpacity).not.toHaveBeenCalled();
    });

    it('clamps opacity below 0.1 to 0.1', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      setOpacity(0.0);
      expect(mockSetOpacity).toHaveBeenCalledWith(0.1);
    });

    it('clamps opacity above 1.0 to 1.0', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      setOpacity(1.5);
      expect(mockSetOpacity).toHaveBeenCalledWith(1.0);
    });
  });

  describe('opacity on startup and show', () => {
    it('applies opacity from config on window creation', () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'opacity') return 0.7;
        if (key === 'dropHeight') return 30;
        return undefined;
      });
      createWindow(configStore as never);

      expect(mockSetOpacity).toHaveBeenCalledWith(0.7);
    });

    it('re-applies opacity after show animation completes', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'opacity') return 0.6;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        if (key === 'focusFade') return false;
        return undefined;
      });
      createWindow(configStore as never);
      mockSetOpacity.mockClear();

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      expect(mockSetOpacity).toHaveBeenCalledWith(0.6);
    });
  });

  describe('opacity hot-reload', () => {
    it('updates BrowserWindow opacity immediately when setOpacity is called with new value', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      mockSetOpacity.mockClear();

      // Simulate hot-reload calling setOpacity with a new value
      setOpacity(0.4);
      expect(mockSetOpacity).toHaveBeenCalledWith(0.4);

      setOpacity(0.9);
      expect(mockSetOpacity).toHaveBeenCalledWith(0.9);
    });
  });

  describe('animation speed from config', () => {
    it('reads animationSpeed from config-store on each toggle', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const showPromise = toggle();
      vi.advanceTimersByTime(250);
      await showPromise;

      // configStore.get should have been called with 'animationSpeed'
      expect(configStore.get).toHaveBeenCalledWith('animationSpeed');
    });

    it('uses custom animationSpeed for show and proportional 0.75 for hide', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'animationSpeed') return 400;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        return undefined;
      });
      createWindow(configStore as never);

      // Show with 400ms speed
      const showStart = performance.now();
      const showPromise = show();
      // Need to advance 400ms for show to complete
      vi.advanceTimersByTime(450);
      await showPromise;

      expect(isVisible()).toBe(true);

      // Hide should use 400 * 0.75 = 300ms
      const hidePromise = hide();
      vi.advanceTimersByTime(350);
      await hidePromise;

      expect(isVisible()).toBe(false);
    });

    it('picks up changed animationSpeed on next toggle without restart', async () => {
      const configStore = createMockConfigStore();
      let speed = 200;
      configStore.get.mockImplementation((key: string) => {
        if (key === 'animationSpeed') return speed;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        return undefined;
      });
      createWindow(configStore as never);

      // First toggle with 200ms speed
      const show1 = show();
      vi.advanceTimersByTime(250);
      await show1;
      expect(isVisible()).toBe(true);

      const hide1 = hide();
      vi.advanceTimersByTime(200);
      await hide1;

      // Change speed to 500ms (simulating hot-reload)
      speed = 500;

      // Next toggle should use 500ms
      const show2 = show();
      vi.advanceTimersByTime(550);
      await show2;
      expect(isVisible()).toBe(true);
      expect(configStore.get).toHaveBeenCalledWith('animationSpeed');
    });

    describe('instant mode (animationSpeed = 0)', () => {
      it('shows window instantly with no animation frames', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 0;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);
        mockSetBounds.mockClear();

        await show();

        // Should be visible immediately
        expect(isVisible()).toBe(true);
        // Final setBounds should position at y=0 (visible)
        const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
        expect(lastCall.y).toBe(0);
      });

      it('hides window instantly with no animation frames', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 0;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        await show();
        mockSetBounds.mockClear();

        await hide();

        expect(isVisible()).toBe(false);
        // Final setBounds should position at y=-height (hidden)
        const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
        expect(lastCall.y).toBe(-312);
      });

      it('fires state-changed callback even in instant mode', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 0;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        const callback = vi.fn();
        onStateChange(callback);

        await show();
        expect(callback).toHaveBeenCalledWith(true);

        await hide();
        expect(callback).toHaveBeenCalledWith(false);
      });

      it('does NOT set animating flag in instant mode', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 0;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        // isAnimating should never be true during instant mode
        await show();
        expect(isAnimating()).toBe(false);
        expect(isVisible()).toBe(true);
      });

      it('negative animationSpeed is clamped to 0 (instant mode)', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return -50;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        await show();
        expect(isVisible()).toBe(true);
        expect(isAnimating()).toBe(false);
      });

      it('animationSpeed of 1 works as near-instant animation', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 1;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        const showPromise = show();
        vi.advanceTimersByTime(50);
        await showPromise;

        expect(isVisible()).toBe(true);
      });

      it('animationSpeed above 1000 is clamped to 1000', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 2000;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        const showPromise = show();
        // 1000ms should be enough even if input is 2000 (clamped to 1000)
        vi.advanceTimersByTime(1050);
        await showPromise;

        expect(isVisible()).toBe(true);
      });
    });
  });

  describe('focus-fade', () => {
    async function showWindow(configStore: ReturnType<typeof createMockConfigStore>) {
      createWindow(configStore as never);
      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;
    }

    it('hides window after 300ms grace period on blur', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();

      expect(isVisible()).toBe(true);

      // Simulate blur
      simulateEvent('blur');

      // Before 300ms, should still be visible
      vi.advanceTimersByTime(200);
      expect(isVisible()).toBe(true);

      // At 300ms, hide should trigger
      vi.advanceTimersByTime(100);
      // Advance through hide animation
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      expect(isVisible()).toBe(false);
    });

    it('does not call native window methods when a pending focus-fade callback runs after destruction', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();

      simulateEvent('blur');
      mockGetBounds.mockClear();
      mockSetBounds.mockClear();
      mockBlur.mockClear();
      mockHide.mockClear();
      mockWindowDestroyed = true;

      vi.advanceTimersByTime(300);
      await vi.runAllTimersAsync();

      expect(mockGetBounds).not.toHaveBeenCalled();
      expect(mockSetBounds).not.toHaveBeenCalled();
      expect(mockBlur).not.toHaveBeenCalled();
      expect(mockHide).not.toHaveBeenCalled();
    });

    it('stops an in-flight focus-fade hide when the window is destroyed', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();

      simulateEvent('blur');
      vi.advanceTimersByTime(300);
      expect(isAnimating()).toBe(true);

      mockGetBounds.mockClear();
      mockSetBounds.mockClear();
      mockBlur.mockClear();
      mockHide.mockClear();
      mockWindowDestroyed = true;

      vi.advanceTimersByTime(16);
      await vi.runAllTimersAsync();

      expect(isAnimating()).toBe(false);
      expect(mockGetBounds).not.toHaveBeenCalled();
      expect(mockSetBounds).not.toHaveBeenCalled();
      expect(mockBlur).not.toHaveBeenCalled();
      expect(mockHide).not.toHaveBeenCalled();
    });

    it('cancels hide when focus returns within 300ms grace period', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();

      // Simulate blur
      simulateEvent('blur');

      // Return focus within 300ms
      vi.advanceTimersByTime(200);
      simulateEvent('focus');

      // Advance well past the 300ms mark
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // Window should still be visible
      expect(isVisible()).toBe(true);
    });

    it('does not hide during shell-launch suppression when focus returns before the guard expires', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();
      suppressFocusFadeForShellLaunch(1000);

      simulateEvent('blur');
      vi.advanceTimersByTime(600);
      expect(isVisible()).toBe(true);

      simulateEvent('focus');
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(isVisible()).toBe(true);
    });

    it('hides after shell-launch suppression expires when blur persists', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      await showWindow(configStore);
      setupFocusFade();
      suppressFocusFadeForShellLaunch(1000);

      simulateEvent('blur');

      vi.advanceTimersByTime(1299);
      expect(isVisible()).toBe(true);

      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      expect(isVisible()).toBe(false);
    });

    it('does not trigger hide when window is already hidden', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      createWindow(configStore as never);
      setupFocusFade();

      // Window starts hidden — blur should not trigger hide
      simulateEvent('blur');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(isVisible()).toBe(false);
    });

    describe('teardownFocusFade()', () => {
      it('removes blur listener so focus-fade no longer triggers', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();
        teardownFocusFade();

        // Blur should not trigger hide anymore
        simulateEvent('blur');
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
      });

      it('clears pending timer when teardown is called during grace period', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Start grace period
        simulateEvent('blur');
        vi.advanceTimersByTime(100);

        // Teardown during grace period
        teardownFocusFade();

        // Timer should have been cleared
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
      });
    });

    describe('with focusFade disabled', () => {
      it('does not hide on blur when focusFade is false', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return false;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        // Don't call setupFocusFade since focusFade is false

        simulateEvent('blur');
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
      });
    });

    describe('focus-fade hot-reload', () => {
      it('disabling focus-fade stops blur from hiding', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Now disable focus-fade (simulating hot-reload)
        teardownFocusFade();

        // Blur should not hide anymore
        simulateEvent('blur');
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
      });

      it('enabling focus-fade starts blur listener', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return false;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        // Start with focus-fade disabled (no setup call)

        // Now enable focus-fade (simulating hot-reload)
        setupFocusFade();

        simulateEvent('blur');
        vi.advanceTimersByTime(300);
        vi.advanceTimersByTime(200);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(false);
      });

      it('clears pending timer when focus-fade is disabled during grace period', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Start grace period
        simulateEvent('blur');
        vi.advanceTimersByTime(150);

        // Disable focus-fade mid-grace-period
        teardownFocusFade();

        // Timer should be cancelled
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
      });
    });

    describe('with settings window open', () => {
      it('does not hide on blur while settings are open', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });

        await showWindow(configStore);
        setupFocusFade();
        await openSettingsWindow('general');

        simulateEvent('blur');
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
        expect(getSettingsWindow()).toBeDefined();
      });

      it('clears pending focus-fade when settings open during the grace period', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });

        await showWindow(configStore);
        setupFocusFade();

        simulateEvent('blur');
        vi.advanceTimersByTime(150);

        await openSettingsWindow('keyboard');

        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();

        expect(isVisible()).toBe(true);
        expect(getSettingsWindow()).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('does not trigger focus-fade during show animation (blur fires during setBounds)', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        createWindow(configStore as never);
        setupFocusFade();

        // Start show animation
        const showPromise = show();

        // Simulate blur events firing during animation (Electron can do this during setBounds)
        simulateEvent('blur');
        vi.advanceTimersByTime(100);
        simulateEvent('blur');

        // Complete show animation
        vi.advanceTimersByTime(200);
        await showPromise;

        // Should still be visible — blur during animation should be ignored
        expect(isVisible()).toBe(true);

        // Grace period from animation-time blur should not trigger hide
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
        expect(isVisible()).toBe(true);
      });

      it('clears focus-fade timer when window is hidden by hotkey during grace period', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Start focus-fade grace period
        simulateEvent('blur');
        vi.advanceTimersByTime(100);

        // User presses hotkey to hide before grace period expires
        const hidePromise = hide();
        vi.advanceTimersByTime(200);
        await hidePromise;

        expect(isVisible()).toBe(false);

        // The focus-fade timer should have been cleared by hide()
        // Advance past original grace period — no double-hide attempts
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      it('does not trigger focus-fade when hide animation is already in progress', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Start hiding by hotkey
        const hidePromise = hide();

        // Blur fires during hide animation
        simulateEvent('blur');

        vi.advanceTimersByTime(200);
        await hidePromise;

        // Should be hidden, and no extra timer should be running
        expect(isVisible()).toBe(false);
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
      });

      it('rapid toggle during focus-fade grace period does not cause issues', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'focusFade') return true;
          if (key === 'opacity') return 0.85;
          if (key === 'dropHeight') return 30;
          if (key === 'animationSpeed') return 200;
          return undefined;
        });
        await showWindow(configStore);
        setupFocusFade();

        // Start grace period
        simulateEvent('blur');
        vi.advanceTimersByTime(100);

        // Rapid toggle: hide
        const hidePromise = hide();
        vi.advanceTimersByTime(200);
        await hidePromise;
        expect(isVisible()).toBe(false);

        // Rapid toggle: show again
        const showPromise = show();
        vi.advanceTimersByTime(250);
        await showPromise;
        expect(isVisible()).toBe(true);

        // No stale timer effects
        vi.advanceTimersByTime(500);
        await vi.runAllTimersAsync();
        expect(isVisible()).toBe(true);
      });
    });
  });

  describe('multi-monitor support', () => {
    const displayA = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    };
    const displayB = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    };

    function createConfigForMultiMon() {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'animationSpeed') return 0;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 50;
        return undefined;
      });
      return configStore;
    }

    it('positions terminal on active monitor (cursor on display B)', async () => {
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayB as Electron.Display);
      vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 2560, y: 400 });

      const configStore = createConfigForMultiMon();
      createWindow(configStore as never);

      await show();

      // 50% of display B workArea height (1400) = 700
      const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(1920);
      expect(lastCall.y).toBe(0);
      expect(lastCall.width).toBe(2560);
      expect(lastCall.height).toBe(700);
    });

    it('repositions terminal when cursor moves to different monitor', async () => {
      const configStore = createConfigForMultiMon();

      // Start on display A
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayA as Electron.Display);
      createWindow(configStore as never);
      await show();

      // Verify on display A: 50% of 1040 = 520
      let lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(0);
      expect(lastCall.width).toBe(1920);
      expect(lastCall.height).toBe(520);

      // Hide
      await hide();

      // Move cursor to display B
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayB as Electron.Display);
      vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 2560, y: 400 });

      await show();

      // Should now be on display B: 50% of 1400 = 700
      lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(1920);
      expect(lastCall.width).toBe(2560);
      expect(lastCall.height).toBe(700);
    });

    it('recalculates dropHeight percentage for different monitor resolutions', async () => {
      const configStore = createConfigForMultiMon();

      // Display A: 50% of 1040 = 520
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayA as Electron.Display);
      createWindow(configStore as never);
      await show();

      let lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.height).toBe(520);

      await hide();

      // Display B: 50% of 1400 = 700
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayB as Electron.Display);
      await show();

      lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.height).toBe(700);
    });

    it('uses workArea (not bounds) for positioning — excludes taskbar', async () => {
      const displayWithTaskbar = {
        id: 3,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 40, width: 1920, height: 1000 }, // taskbar at top (40px)
      };
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayWithTaskbar as Electron.Display);

      const configStore = createConfigForMultiMon();
      createWindow(configStore as never);
      await show();

      const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      // Should position at workArea.y = 40, not bounds.y = 0
      expect(lastCall.y).toBe(40);
      // Height: 50% of 1000 = 500
      expect(lastCall.height).toBe(500);
    });

    it('handles display-removed by repositioning to primary display', async () => {
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayB as Electron.Display);
      vi.mocked(screen.getPrimaryDisplay).mockReturnValue(displayA as Electron.Display);

      const configStore = createConfigForMultiMon();
      createWindow(configStore as never);
      await show();

      // Verify on display B
      expect(isVisible()).toBe(true);

      // Simulate display-removed event
      const displayRemovedHandler = vi.mocked(screen.on).mock.calls.find(
        (call) => call[0] === 'display-removed',
      )?.[1] as Function;
      expect(displayRemovedHandler).toBeDefined();

      mockSetBounds.mockClear();
      displayRemovedHandler({}, displayB);

      // Should reposition to primary display A
      const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(0);
      expect(lastCall.width).toBe(1920);
      // 50% of 1040 = 520
      expect(lastCall.height).toBe(520);
    });

    it('does NOT reposition on display-removed if terminal was on a different display', async () => {
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayA as Electron.Display);

      const configStore = createConfigForMultiMon();
      createWindow(configStore as never);
      await show();

      // Simulate removal of display B (terminal is on A)
      const displayRemovedHandler = vi.mocked(screen.on).mock.calls.find(
        (call) => call[0] === 'display-removed',
      )?.[1] as Function;

      mockSetBounds.mockClear();
      displayRemovedHandler({}, displayB);

      // No repositioning needed
      expect(mockSetBounds).not.toHaveBeenCalled();
    });

    it('single monitor has no multi-monitor overhead', async () => {
      // Default mock is already single-monitor (display A)
      vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displayA as Electron.Display);

      const configStore = createConfigForMultiMon();
      createWindow(configStore as never);
      await show();

      expect(isVisible()).toBe(true);
      const lastCall = mockSetBounds.mock.calls[mockSetBounds.mock.calls.length - 1][0];
      expect(lastCall.x).toBe(0);
      expect(lastCall.width).toBe(1920);
    });
  });

  describe('focus management', () => {
    it('sends terminal:focus IPC after show animation completes', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:focus');
    });

    it('sends terminal:focus IPC in instant show mode', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'animationSpeed') return 0;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        return undefined;
      });
      createWindow(configStore as never);

      await show();

      expect(mockWebContents.send).toHaveBeenCalledWith('terminal:focus');
    });

    it('calls win.focus() after show animation', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      expect(mockFocus).toHaveBeenCalled();
    });

    it('calls win.blur() after hide animation', async () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      mockBlur.mockClear();

      const hidePromise = hide();
      vi.advanceTimersByTime(200);
      await hidePromise;

      expect(mockBlur).toHaveBeenCalled();
    });

    it('calls win.blur() in instant hide mode', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'animationSpeed') return 0;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        return undefined;
      });
      createWindow(configStore as never);

      await show();
      mockBlur.mockClear();

      await hide();

      expect(mockBlur).toHaveBeenCalled();
    });

    it('does not attempt to restore focus explicitly on blur-triggered hide', async () => {
      const configStore = createMockConfigStore();
      configStore.get.mockImplementation((key: string) => {
        if (key === 'focusFade') return true;
        if (key === 'opacity') return 0.85;
        if (key === 'dropHeight') return 30;
        if (key === 'animationSpeed') return 200;
        return undefined;
      });
      createWindow(configStore as never);

      const showPromise = show();
      vi.advanceTimersByTime(250);
      await showPromise;

      setupFocusFade();
      mockBlur.mockClear();

      // Blur-triggered hide: blur calls win.blur() but OS handles focus
      simulateEvent('blur');
      vi.advanceTimersByTime(300);
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      // win.blur() is called as part of hide() — this is correct
      // The key assertion is that no explicit focus restoration happens
      expect(isVisible()).toBe(false);
      expect(mockBlur).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    describe('reduced motion', () => {
      it('sets and gets reduced motion flag', () => {
        setReducedMotion(true);
        expect(getReducedMotion()).toBe(true);
        setReducedMotion(false);
        expect(getReducedMotion()).toBe(false);
      });

      it('uses instant show/hide when reduced motion is active', async () => {
        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'animationSpeed') return 200;
          if (key === 'dropHeight') return 30;
          if (key === 'opacity') return 0.85;
          return undefined;
        });
        createWindow(configStore as never);

        setReducedMotion(true);

        // Show should be instant (no animation frames)
        await show();
        expect(isVisible()).toBe(true);
        // Should be at final position immediately (y=0 for top of workArea)
        expect(mockSetBounds).toHaveBeenCalledWith(
          expect.objectContaining({ y: 0 }),
        );

        // Hide should be instant too
        await hide();
        expect(isVisible()).toBe(false);
      });
    });

    describe('high contrast', () => {
      it('sets opacity to 1.0 when high contrast is active at startup', () => {
        (nativeTheme as { shouldUseHighContrastColors: boolean }).shouldUseHighContrastColors = true;

        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'opacity') return 0.5;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);

        // Should have called setOpacity with 1.0, not 0.5
        expect(mockSetOpacity).toHaveBeenCalledWith(1.0);

        // Cleanup
        (nativeTheme as { shouldUseHighContrastColors: boolean }).shouldUseHighContrastColors = false;
      });

      it('overrides setOpacity to 1.0 when high contrast is active', () => {
        (nativeTheme as { shouldUseHighContrastColors: boolean }).shouldUseHighContrastColors = true;

        const configStore = createMockConfigStore();
        createWindow(configStore as never);
        mockSetOpacity.mockClear();

        setOpacity(0.5);
        expect(mockSetOpacity).toHaveBeenCalledWith(1.0);

        // Cleanup
        (nativeTheme as { shouldUseHighContrastColors: boolean }).shouldUseHighContrastColors = false;
      });

      it('restores normal opacity when high contrast is disabled', () => {
        (nativeTheme as { shouldUseHighContrastColors: boolean }).shouldUseHighContrastColors = false;

        const configStore = createMockConfigStore();
        configStore.get.mockImplementation((key: string) => {
          if (key === 'opacity') return 0.7;
          if (key === 'dropHeight') return 30;
          return undefined;
        });
        createWindow(configStore as never);
        mockSetOpacity.mockClear();

        setOpacity(0.7);
        expect(mockSetOpacity).toHaveBeenCalledWith(0.7);
      });
    });
  });

  describe('startResizeDrag / stopResizeDrag', () => {
    let mockGetCursorScreenPoint: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Provide the cursor position used by the polling interval
      mockGetCursorScreenPoint = vi.fn().mockReturnValue({ x: 0, y: 500 });
      (screen.getCursorScreenPoint as ReturnType<typeof vi.fn>) = mockGetCursorScreenPoint;
    });

    afterEach(() => {
      // Always clean up any live poll timer so it doesn't leak into other tests
      stopResizeDrag(false);
    });

    it('starts polling and applies clamped height on each tick', () => {
      vi.useFakeTimers();
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      mockSetBounds.mockClear();

      // workArea y=0, height=1040 → cursor at y=500 → desiredPx=500
      mockGetCursorScreenPoint.mockReturnValue({ x: 0, y: 500 });
      startResizeDrag();
      vi.advanceTimersByTime(16);

      expect(mockSetBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 500 }));
      vi.useRealTimers();
    });

    it('clamps cursor below 10% minimum', () => {
      vi.useFakeTimers();
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      mockSetBounds.mockClear();

      // cursor at y=10 → desiredPx=10 → clamped to 10% of 1040 = 104
      mockGetCursorScreenPoint.mockReturnValue({ x: 0, y: 10 });
      startResizeDrag();
      vi.advanceTimersByTime(16);

      expect(mockSetBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 104 }));
      vi.useRealTimers();
    });

    it('clamps cursor above 90% maximum', () => {
      vi.useFakeTimers();
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      mockSetBounds.mockClear();

      // cursor at y=1100 → desiredPx=1100 → clamped to 90% of 1040 = 936
      mockGetCursorScreenPoint.mockReturnValue({ x: 0, y: 1100 });
      startResizeDrag();
      vi.advanceTimersByTime(16);

      expect(mockSetBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 936 }));
      vi.useRealTimers();
    });

    it('stopResizeDrag persists clamped height as percentage', () => {
      vi.useFakeTimers();
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      configStore.set.mockClear();

      // Resize to 520px (50% of 1040), then stop with persist=true
      mockGetCursorScreenPoint.mockReturnValue({ x: 0, y: 520 });
      startResizeDrag();
      vi.advanceTimersByTime(16);
      stopResizeDrag(true);

      expect(configStore.set).toHaveBeenCalledWith('dropHeight', 50);
      vi.useRealTimers();
    });

    it('stopResizeDrag does not persist when persist=false', () => {
      vi.useFakeTimers();
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      configStore.set.mockClear();

      startResizeDrag();
      vi.advanceTimersByTime(16);
      stopResizeDrag(false);

      expect(configStore.set).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('resetWindowHeight', () => {
    it('resets window height to 40% of workArea and persists', () => {
      const configStore = createMockConfigStore();
      createWindow(configStore as never);
      mockSetBounds.mockClear();
      configStore.set.mockClear();

      resetWindowHeight();
      // 40% of 1040 = 416
      expect(mockSetBounds).toHaveBeenCalledWith(expect.objectContaining({ height: 416 }));
      expect(configStore.set).toHaveBeenCalledWith('dropHeight', 40);
    });
  });
});