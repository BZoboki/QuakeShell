import { useEffect, useRef } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  opacity as opacitySignal,
  fontSize as fontSizeSignal,
  fontFamily as fontFamilySignal,
  lineHeight as lineHeightSignal,
} from '../../state/config-store';
import { activeTheme, getCurrentTheme } from '../../state/theme-store';
import { getTerminalPtyInfo } from '../../state/platform-store';
import { tokyoNightTheme } from '../../theme/tokyo-night';
import '@xterm/xterm/css/xterm.css';

/** ANSI escape for dimmed text (#565f89) */
const DIMMED = '\x1b[38;2;86;95;137m';
const RESET = '\x1b[0m';

type SessionState = 'running' | 'exited';

interface TabExitPayload {
  tabId: string;
  exitCode: number;
  signal: number;
}

function buildTerminalTheme(theme: ITheme | undefined): ITheme {
  return {
    ...(theme ?? tokyoNightTheme),
    background: '#00000000',
  };
}

export interface TerminalViewProps {
  tabId: string;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
}

export function TerminalView({
  tabId,
  opacity,
  fontSize,
  fontFamily,
  lineHeight,
}: TerminalViewProps) {
  const currentOpacity = opacity ?? opacitySignal.value;
  const currentFontSize = fontSize ?? fontSizeSignal.value;
  const currentFontFamily = fontFamily ?? fontFamilySignal.value;
  const currentLineHeight = lineHeight ?? lineHeightSignal.value;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionStateRef = useRef<SessionState>('running');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Windows/ConPTY-only: tells xterm.js which reflow strategy to use on
    // column-count resize. Without this, xterm's generic reflow doesn't match
    // ConPTY's line-wrap semantics and corrupts the scrollback buffer on
    // resize. `terminalPtyInfo` is null on macOS/Linux or if the boot-time
    // IPC query failed, in which case `windowsPty` is simply omitted.
    const terminalPtyInfo = getTerminalPtyInfo();

    const terminal = new Terminal({
      fontFamily: currentFontFamily,
      fontSize: currentFontSize,
      lineHeight: currentLineHeight,
      theme: buildTerminalTheme(getCurrentTheme()?.xtermTheme),
      scrollback: 5000,
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      screenReaderMode: true,
      ...(terminalPtyInfo ? { windowsPty: terminalPtyInfo } : {}),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(container);

    // WebGL addon does not support allowTransparency — skip it.
    // Canvas renderer handles transparency correctly.

    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Wire xterm user input → PTY (renderer → main)
    // When 'exited', only Enter closes the tab; all other input is suppressed.
    const inputDisposable = terminal.onData((data: string) => {
      if (sessionStateRef.current === 'exited') {
        if (data === '\r') {
          window.quakeshell.tab.close(tabId).catch(() => {
            terminal.write(`\r\n${DIMMED}[Failed to close tab. Try closing it from the tab bar.]${RESET}\r\n`);
          });
        }
        return; // suppress all other input in exited state
      }
      window.quakeshell.tab.input(tabId, data);
    });

    // Wire PTY output → xterm (main → renderer)
    const removeDataListener = window.quakeshell.tab.onData(
      (payload: { tabId: string; data: string }) => {
        if (payload.tabId !== tabId) return;
        terminal.write(payload.data);
      },
    );

    // Sync terminal dimensions with PTY on resize
    const resizeDisposable = terminal.onResize(
      ({ cols, rows }: { cols: number; rows: number }) => {
        window.quakeshell.tab.resize(tabId, cols, rows);
      },
    );

    // Handle window resize → refit terminal
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    // Also observe container size changes (e.g. split pane layout)
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    // Clipboard: Ctrl+C with selection = copy, otherwise pass through
    const keyDisposable = terminal.onKey(
      (e: { key: string; domEvent: KeyboardEvent }) => {
        const { domEvent } = e;
        if (domEvent.ctrlKey && domEvent.key === 'c' && terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
          domEvent.preventDefault();
        }
      },
    );

    // Do not add Ctrl+V handling here — xterm's textarea already has a native 'paste' event listener that forwards pasted text via onData.
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.defaultPrevented) {
        return false;
      }

      // Let Ctrl+C with selection be handled by onKey above
      if (e.ctrlKey && e.key === 'c' && terminal.hasSelection()) {
        return false;
      }
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === ',') {
        return false;
      }
      // Pass tab shortcuts through to the global handler
      if (e.type === 'keydown' && e.ctrlKey) {
        if (e.key === 't' || e.key === 'w' || e.key === 'Tab'
          || (e.key >= '1' && e.key <= '9')
          || (e.shiftKey && e.key === 'D')) {
          return false;
        }
      }
      return true;
    });

    // Right-click context: copy if selection, otherwise paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
        terminal.clearSelection();
      } else {
        navigator.clipboard.readText().then((text) => {
          if (text) {
            window.quakeshell.tab.input(tabId, text);
          }
        });
      }
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // Resize the PTY to match actual terminal dimensions
    window.quakeshell.tab.resize(tabId, terminal.cols, terminal.rows);

    // Listen for tab-scoped PTY exit events from the main process.
    const removeExitListener = window.quakeshell.tab.onExited(
      (payload: TabExitPayload) => {
        if (payload.tabId !== tabId) return;
        terminal.write(`\r\n${DIMMED}[Process exited with code ${payload.exitCode}. Press Enter to close this tab.]${RESET}\r\n`);
        sessionStateRef.current = 'exited';
      },
    );

    // Focus terminal on mount
    terminal.focus();

    // Listen for focus IPC from main process (triggered after show animation)
    const removeFocusListener = window.quakeshell.terminal.onFocus(() => {
      terminal.focus();
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      container.removeEventListener('contextmenu', handleContextMenu);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      keyDisposable.dispose();
      removeDataListener();
      removeExitListener();
      removeFocusListener();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      sessionStateRef.current = 'running';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- terminal created once, font updates handled separately

  useSignalEffect(() => {
    const theme = activeTheme.value;
    const terminal = terminalRef.current;

    if (!theme || !terminal) {
      return;
    }

    terminal.options.theme = buildTerminalTheme(theme.xtermTheme);
  });

  // Live-update font settings from config signals without recreating the terminal
  const liveFontSize = fontSizeSignal.value;
  const liveFontFamily = fontFamilySignal.value;
  const liveLineHeight = lineHeightSignal.value;
  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    let changed = false;
    if (terminal.options.fontSize !== liveFontSize) {
      terminal.options.fontSize = liveFontSize;
      changed = true;
    }
    if (terminal.options.fontFamily !== liveFontFamily) {
      terminal.options.fontFamily = liveFontFamily;
      changed = true;
    }
    if (terminal.options.lineHeight !== liveLineHeight) {
      terminal.options.lineHeight = liveLineHeight;
      changed = true;
    }
    if (changed) {
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
      fitAddon.fit();
    }
  }, [liveFontSize, liveFontFamily, liveLineHeight]);

  return (
    <div
      style={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: currentOpacity >= 1
            ? 'var(--bg-terminal)'
            : `color-mix(in srgb, var(--bg-terminal) ${currentOpacity * 100}%, transparent)`,
          overflow: 'hidden',
          padding: '8px 12px 0',
        }}
      >
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: 'calc(100% - 4px)',
          }}
        />
      </div>
      <div
        style={{
          height: '2px',
          background: 'var(--accent)',
          flexShrink: 0,
        }}
      />
    </div>
  );
}
