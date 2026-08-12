// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const mockSignals = vi.hoisted(() => ({
  opacity: { value: 0.85 },
  fontSize: { value: 14 },
  fontFamily: { value: 'Cascadia Code, Consolas, Courier New, monospace' },
  lineHeight: { value: 1.2 },
}));

const mockTerminalInstance = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  write: vi.fn(),
  refresh: vi.fn(),
  onData: vi.fn(),
  onResize: vi.fn(),
  onKey: vi.fn(),
  hasSelection: vi.fn(() => false),
  getSelection: vi.fn(() => ''),
  clearSelection: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  cols: 80,
  rows: 24,
  options: {
    fontSize: 14,
    fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
    lineHeight: 1.2,
    theme: undefined as unknown,
  },
};

const mockTerminalConstructor = vi.hoisted(() =>
  vi.fn(function TerminalMock(options: Record<string, unknown>) {
    mockTerminalInstance.options = {
      ...mockTerminalInstance.options,
      ...options,
    };
    return mockTerminalInstance;
  }),
);

const mockFitAddonInstance = vi.hoisted(() => ({
  fit: vi.fn(),
  dispose: vi.fn(),
}));

const mockFitAddonConstructor = vi.hoisted(() =>
  vi.fn(function FitAddonMock() {
    return mockFitAddonInstance;
  }),
);

const mockWebLinksAddonConstructor = vi.hoisted(() =>
  vi.fn(function WebLinksAddonMock() {
    return { dispose: vi.fn() };
  }),
);

vi.mock('@xterm/xterm', () => ({
  Terminal: mockTerminalConstructor,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: mockFitAddonConstructor,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: mockWebLinksAddonConstructor,
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('../../state/config-store', () => ({
  opacity: mockSignals.opacity,
  fontSize: mockSignals.fontSize,
  fontFamily: mockSignals.fontFamily,
  lineHeight: mockSignals.lineHeight,
}));

vi.mock('../../theme/tokyo-night', () => ({
  tokyoNightTheme: {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#7aa2f7',
    cursorAccent: '#1a1b26',
    selectionBackground: '#283457',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
}));

import { activeTheme } from '../../state/theme-store';
import { TerminalView } from './TerminalView';

globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as unknown as typeof ResizeObserver;

const solarizedTheme = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  xtermTheme: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
  },
  chromeTokens: {
    bgTerminal: '#002b36',
    bgChrome: '#00212b',
    fgPrimary: '#839496',
    fgDimmed: '#586e75',
    accent: '#268bd2',
    border: '#073642',
  },
};

const retroTheme = {
  id: 'retro-green',
  name: 'Retro Green',
  xtermTheme: {
    background: '#0a0f0a',
    foreground: '#33ff33',
    cursor: '#66ff66',
    cursorAccent: '#0a0f0a',
    selectionBackground: '#1a3d1a',
  },
  chromeTokens: {
    bgTerminal: '#0a0f0a',
    bgChrome: '#050805',
    fgPrimary: '#33ff33',
    fgDimmed: '#226622',
    accent: '#66ff66',
    border: '#1a3d1a',
  },
};

let terminalDataHandler: ((data: string) => void) | null = null;
let terminalResizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;
let terminalKeyHandler: ((event: { key: string; domEvent: KeyboardEvent }) => void) | null = null;
let tabExitedHandler: ((payload: { tabId: string; exitCode: number; signal: number }) => void) | null = null;
let focusHandler: (() => void) | null = null;
let tabDataHandler: ((payload: { tabId: string; data: string }) => void) | null = null;
let customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;

const removeTabExitedListener = vi.fn();
const removeFocusListener = vi.fn();
const removeTabDataListener = vi.fn();

const mockTerminalAPI = {
  spawn: vi.fn(),
  resize: vi.fn(),
  respawnShell: vi.fn().mockResolvedValue(undefined),
  onFocus: vi.fn((callback: () => void) => {
    focusHandler = callback;
    return removeFocusListener;
  }),
};

const mockTabAPI = {
  input: vi.fn(),
  resize: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  onData: vi.fn((callback: (payload: { tabId: string; data: string }) => void) => {
    tabDataHandler = callback;
    return removeTabDataListener;
  }),
  onExited: vi.fn((callback: (payload: { tabId: string; exitCode: number; signal: number }) => void) => {
    tabExitedHandler = callback;
    return removeTabExitedListener;
  }),
  onAutoName: vi.fn(() => vi.fn()),
};

Object.defineProperty(window, 'quakeshell', {
  value: {
    config: {
      getAll: vi.fn(),
    },
    terminal: mockTerminalAPI,
    tab: mockTabAPI,
  },
  writable: true,
  configurable: true,
});

Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue('pasted text'),
  },
  configurable: true,
});

describe('renderer/TerminalView', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();

    terminalDataHandler = null;
    terminalResizeHandler = null;
    terminalKeyHandler = null;
    tabExitedHandler = null;
    focusHandler = null;
    tabDataHandler = null;
    customKeyHandler = null;

    mockTerminalInstance.onData.mockImplementation((callback: (data: string) => void) => {
      terminalDataHandler = callback;
      return { dispose: vi.fn() };
    });
    mockTerminalInstance.onResize.mockImplementation((callback: (size: { cols: number; rows: number }) => void) => {
      terminalResizeHandler = callback;
      return { dispose: vi.fn() };
    });
    mockTerminalInstance.onKey.mockImplementation((callback: (event: { key: string; domEvent: KeyboardEvent }) => void) => {
      terminalKeyHandler = callback;
      return { dispose: vi.fn() };
    });
    mockTerminalInstance.attachCustomKeyEventHandler.mockImplementation((callback: (event: KeyboardEvent) => boolean) => {
      customKeyHandler = callback;
    });
    mockTerminalInstance.cols = 80;
    mockTerminalInstance.rows = 24;
    mockTerminalInstance.options = {
      fontSize: 14,
      fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
      lineHeight: 1.2,
      theme: undefined,
    };

    mockSignals.opacity.value = 0.85;
    mockSignals.fontSize.value = 14;
    mockSignals.fontFamily.value = 'Cascadia Code, Consolas, Courier New, monospace';
    mockSignals.lineHeight.value = 1.2;
    activeTheme.value = solarizedTheme;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
  });

  function mount(props: Partial<Parameters<typeof TerminalView>[0]> = {}) {
    act(() => {
      render(<TerminalView tabId="default" {...props} />, container);
    });
  }

  it('creates an xterm Terminal instance on mount', () => {
    mount();

    expect(mockTerminalConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        scrollback: 5000,
        allowTransparency: true,
        cursorBlink: true,
        cursorStyle: 'bar',
        screenReaderMode: true,
      }),
    );
  });

  it('applies the active theme with a transparent background override', () => {
    mount();

    expect(mockTerminalConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: '#00000000',
          foreground: '#839496',
          cursor: '#839496',
          cursorAccent: '#002b36',
          selectionBackground: '#073642',
        }),
      }),
    );
  });

  it('opens the terminal into the container DOM element', () => {
    mount();

    expect(mockTerminalInstance.open).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });

  it('loads FitAddon and WebLinksAddon', () => {
    mount();

    expect(mockFitAddonConstructor).toHaveBeenCalledTimes(1);
    expect(mockWebLinksAddonConstructor).toHaveBeenCalledTimes(1);
    expect(mockTerminalInstance.loadAddon).toHaveBeenCalledTimes(2);
  });

  it('wires terminal onData to quakeshell.tab.input', () => {
    mount();

    terminalDataHandler?.('pwd\r');
    expect(mockTabAPI.input).toHaveBeenCalledWith('default', 'pwd\r');
  });

  it('wires quakeshell.tab.onData to terminal.write', () => {
    mount();

    tabDataHandler?.({ tabId: 'default', data: 'hello' });
    tabDataHandler?.({ tabId: 'other', data: 'ignored' });

    expect(mockTerminalInstance.write).toHaveBeenCalledWith('hello');
    expect(mockTerminalInstance.write).toHaveBeenCalledTimes(1);
  });

  it('registers resize handler to sync PTY dimensions', () => {
    mount();

    terminalResizeHandler?.({ cols: 132, rows: 42 });
    expect(mockTabAPI.resize).toHaveBeenCalledWith('default', 132, 42);
  });

  it('accepts custom opacity, fontSize, fontFamily, and lineHeight props', () => {
    mount({ opacity: 0.5, fontSize: 18, fontFamily: 'monospace', lineHeight: 1.5 });

    expect(mockTerminalConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: 'monospace',
        fontSize: 18,
        lineHeight: 1.5,
      }),
    );
  });

  it('renders the accent bottom edge line', () => {
    mount();

    const edge = container.firstElementChild?.lastElementChild as HTMLDivElement | null;
    expect(edge).not.toBeNull();
    expect(edge?.getAttribute('style')).toContain('background: var(--accent);');
  });

  it('disposes the terminal on unmount', () => {
    mount();

    act(() => {
      render(null, container);
    });

    expect(mockTerminalInstance.dispose).toHaveBeenCalledTimes(1);
    expect(removeTabDataListener).toHaveBeenCalledTimes(1);
    expect(removeTabExitedListener).toHaveBeenCalledTimes(1);
    expect(removeFocusListener).toHaveBeenCalledTimes(1);
  });

  it('focuses the terminal on mount', () => {
    mount();

    expect(mockTerminalInstance.focus).toHaveBeenCalledTimes(1);
  });

  it('resizes the tab PTY to fitted dimensions after setup', () => {
    mount();

    expect(mockFitAddonInstance.fit).toHaveBeenCalled();
    expect(mockTabAPI.resize).toHaveBeenCalledWith('default', 80, 24);
  });

  it('attaches a custom key event handler for clipboard and shortcut passthrough', () => {
    mount();

    expect(mockTerminalInstance.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
    expect(customKeyHandler).toBeTypeOf('function');
  });

  it('does not intercept Ctrl+V, leaving paste to xterm\'s native handling to avoid double-pasting', () => {
    mount();

    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true });
    const result = customKeyHandler?.(event);

    expect(result).toBe(true);
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(mockTabAPI.input).not.toHaveBeenCalled();
  });

  it('updates xterm font options when fontSize signal changes', () => {
    mount();

    mockSignals.fontSize.value = 20;
    mount();

    expect(mockTerminalInstance.options.fontSize).toBe(20);
    expect(mockTerminalInstance.refresh).toHaveBeenCalled();
  });

  it('updates xterm font options when fontFamily signal changes', () => {
    mount();

    mockSignals.fontFamily.value = 'Fira Code';
    mount();

    expect(mockTerminalInstance.options.fontFamily).toBe('Fira Code');
    expect(mockTerminalInstance.refresh).toHaveBeenCalled();
  });

  it('updates xterm font options when lineHeight signal changes', () => {
    mount();

    mockSignals.lineHeight.value = 1.4;
    mount();

    expect(mockTerminalInstance.options.lineHeight).toBe(1.4);
    expect(mockTerminalInstance.refresh).toHaveBeenCalled();
  });

  it('updates xterm theme when the active theme changes', () => {
    mount();

    act(() => {
      activeTheme.value = retroTheme;
    });

    expect(mockTerminalInstance.options.theme).toEqual(
      expect.objectContaining({
        background: '#00000000',
        foreground: '#33ff33',
        cursor: '#66ff66',
      }),
    );
  });

  it('registers tab.onExited listener on mount', () => {
    mount();

    expect(mockTabAPI.onExited).toHaveBeenCalledTimes(1);
  });

  it('writes an exit message to xterm when this tab exits', () => {
    mount();

    tabExitedHandler?.({ tabId: 'default', exitCode: 0, signal: 0 });

    expect(mockTerminalInstance.write).toHaveBeenCalledWith(
      expect.stringContaining('Process exited with code 0. Press Enter to close this tab.'),
    );
  });

  it('writes an exit message with the non-zero exit code on crash', () => {
    mount();

    tabExitedHandler?.({ tabId: 'default', exitCode: 7, signal: 0 });

    expect(mockTerminalInstance.write).toHaveBeenCalledWith(
      expect.stringContaining('Process exited with code 7. Press Enter to close this tab.'),
    );
  });

  it('ignores exit events from other tabs', () => {
    mount();

    tabExitedHandler?.({ tabId: 'other-tab', exitCode: 1, signal: 0 });

    expect(mockTerminalInstance.write).not.toHaveBeenCalledWith(
      expect.stringContaining('Press Enter to close this tab.'),
    );
  });

  it('closes the tab when Enter is pressed after exit', async () => {
    mount();

    tabExitedHandler?.({ tabId: 'default', exitCode: 1, signal: 0 });
    terminalDataHandler?.('\r');

    await Promise.resolve();
    expect(mockTabAPI.close).toHaveBeenCalledWith('default');
  });

  it('suppresses non-Enter keyboard input in exited state', () => {
    mount();

    tabExitedHandler?.({ tabId: 'default', exitCode: 1, signal: 0 });
    terminalDataHandler?.('a');

    expect(mockTabAPI.input).not.toHaveBeenCalledWith('default', 'a');
  });

  it('prints a helpful error when closing the exited tab fails', async () => {
    mount();
    mockTabAPI.close.mockRejectedValueOnce(new Error('close failed'));

    tabExitedHandler?.({ tabId: 'default', exitCode: 1, signal: 0 });
    terminalDataHandler?.('\r');
    await Promise.resolve();

    expect(mockTerminalInstance.write).toHaveBeenCalledWith(
      expect.stringContaining('Failed to close tab. Try closing it from the tab bar.'),
    );
  });

  it('registers onFocus listener on mount', () => {
    mount();

    expect(mockTerminalAPI.onFocus).toHaveBeenCalledTimes(1);
  });

  it('calls terminal.focus() when onFocus IPC fires', () => {
    mount();

    focusHandler?.();
    expect(mockTerminalInstance.focus).toHaveBeenCalledTimes(2);
  });

  it('copies the selection on Ctrl+C when text is selected', () => {
    mount();

    mockTerminalInstance.hasSelection.mockReturnValue(true);
    mockTerminalInstance.getSelection.mockReturnValue('selected text');

    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    terminalKeyHandler?.({ key: 'c', domEvent: event });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('selected text');
    expect(mockTerminalInstance.clearSelection).toHaveBeenCalledTimes(1);
  });
});
