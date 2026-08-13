// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('./ThemeStyleInjector', () => ({
  default: () => null,
}));

vi.mock('./ShellPicker/ShellPicker', () => ({
  ShellPicker: ({ tabId }: { tabId: string }) => <div data-testid={`picker-${tabId}`}>{tabId}</div>,
}));

vi.mock('./SplitPane', () => ({
  default: ({
    tabIds,
    visibleTabIds = tabIds,
    focusedPaneTabId,
  }: {
    tabIds: string[];
    visibleTabIds?: string[];
    focusedPaneTabId: string | null;
  }) => (
    <div
      data-testid="split-pane"
      data-terminal-tab-ids={tabIds.join('|')}
      data-visible-tab-ids={visibleTabIds.join('|')}
      data-focused-pane-id={focusedPaneTabId ?? ''}
    >
      {`${visibleTabIds.join('|')}|${focusedPaneTabId}`}
    </div>
  ),
}));

vi.mock('./ResizeHandle/ResizeHandle', () => ({
  default: () => <div data-testid="resize-handle" />,
}));

vi.mock('./Onboarding/OnboardingOverlay', () => ({
  default: () => null,
}));

vi.mock('./UpdateRestartPrompt', () => ({
  default: () => null,
}));

vi.mock('./SettingsPanel', () => ({
  default: () => null,
}));

vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => undefined,
}));

const configSignals = vi.hoisted(() => ({
  opacity: { value: 0.85 },
  fontSize: { value: 14 },
  fontFamily: { value: 'Cascadia Code' },
  lineHeight: { value: 1.2 },
  initConfigStore: vi.fn(),
}));

vi.mock('../state/config-store', () => ({
  opacity: configSignals.opacity,
  fontSize: configSignals.fontSize,
  fontFamily: configSignals.fontFamily,
  lineHeight: configSignals.lineHeight,
  initConfigStore: configSignals.initConfigStore,
}));

const themeSignals = vi.hoisted(() => ({
  initThemeStore: vi.fn().mockResolvedValue(undefined),
}));

const platformSignals = vi.hoisted(() => ({
  initPlatformStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../state/platform-store', () => ({
  initPlatformStore: platformSignals.initPlatformStore,
}));

const mockWindowAPI = {
  openSettings: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../state/theme-store', () => ({
  initThemeStore: themeSignals.initThemeStore,
}));

const tabs = [
  { id: 'tab-1', manualName: 'One', shellType: 'pwsh', status: 'running', color: '#7aa2f7', createdAt: 1 },
  { id: 'tab-2', manualName: 'Two', shellType: 'pwsh', status: 'running', color: '#9ece6a', createdAt: 2 },
  { id: 'tab-3', manualName: 'Three', shellType: 'pwsh', status: 'running', color: '#bb9af7', createdAt: 3 },
];

let closedListener: ((payload: { tabId: string }) => void) | null = null;
let activeChangedListener: ((payload: { tabId: string }) => void) | null = null;

const mockTabAPI = {
  list: vi.fn().mockResolvedValue(tabs),
  create: vi.fn(),
  createSplit: vi.fn(),
  spawnTab: vi.fn(),
  availableShells: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  switchTo: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn(),
  reorder: vi.fn(async (tabIds: string[]) =>
    tabIds
      .map((tabId) => tabs.find((tab) => tab.id === tabId))
      .filter((tab): tab is (typeof tabs)[number] => tab !== undefined)),
  input: vi.fn(),
  resize: vi.fn(),
  onData: vi.fn(() => vi.fn()),
  onClosed: vi.fn((callback: (payload: { tabId: string }) => void) => {
    closedListener = callback;
    return vi.fn();
  }),
  onActiveChanged: vi.fn((callback: (payload: { tabId: string }) => void) => {
    activeChangedListener = callback;
    return vi.fn();
  }),
  onExited: vi.fn(() => vi.fn()),
  onRenamed: vi.fn(() => vi.fn()),
  onAutoName: vi.fn(() => vi.fn()),
};

Object.defineProperty(window, 'quakeshell', {
  value: {
    config: {
      getAll: vi.fn(),
      onConfigChange: vi.fn(() => vi.fn()),
      openInEditor: vi.fn(),
    },
    terminal: {},
    tab: mockTabAPI,
    window: mockWindowAPI,
    app: {},
  },
  writable: true,
});

import { linkedTabGroups, focusedPaneTabId } from '../state/tab-store';
import { App } from './App';

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function dispatchDragEvent(node: Element | null, type: string) {
  if (!node) return;

  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
    },
  });
  node.dispatchEvent(event);
}

describe('renderer/App hover tab linking', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    linkedTabGroups.value = [];
    focusedPaneTabId.value = null;
    closedListener = null;
    activeChangedListener = null;
    mockTabAPI.list.mockResolvedValue(tabs);
    mockWindowAPI.openSettings.mockResolvedValue(undefined);

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('hosts every running tab while displaying only the active tab', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const terminalHost = container.querySelector('[data-testid="split-pane"]');

    expect(terminalHost?.getAttribute('data-terminal-tab-ids')).toBe('tab-1|tab-2|tab-3');
    expect(terminalHost?.getAttribute('data-visible-tab-ids')).toBe('tab-1');
  });

  it('changes visible panes without replacing the persistent terminal set', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const terminalHost = container.querySelector('[data-testid="split-pane"]');

    await act(async () => {
      activeChangedListener?.({ tabId: 'tab-2' });
    });
    await flushPromises();

    const switchedTerminalHost = container.querySelector('[data-testid="split-pane"]');
    expect(switchedTerminalHost).toBe(terminalHost);
    expect(switchedTerminalHost?.getAttribute('data-terminal-tab-ids')).toBe('tab-1|tab-2|tab-3');
    expect(switchedTerminalHost?.getAttribute('data-visible-tab-ids')).toBe('tab-2');
  });

  it('keeps running terminals mounted while a pending tab shows the shell picker', async () => {
    const tabsWithPending = [
      tabs[0],
      { ...tabs[1], status: 'pending' },
      tabs[2],
    ];
    mockTabAPI.list.mockResolvedValue(tabsWithPending);

    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const terminalHost = container.querySelector('[data-testid="split-pane"]');

    await act(async () => {
      activeChangedListener?.({ tabId: 'tab-2' });
    });
    await flushPromises();

    const hiddenTerminalHost = container.querySelector('[data-testid="split-pane"]');
    expect(container.querySelector('[data-testid="picker-tab-2"]')).not.toBeNull();
    expect(hiddenTerminalHost).toBe(terminalHost);
    expect(hiddenTerminalHost?.getAttribute('data-terminal-tab-ids')).toBe('tab-1|tab-3');
    expect(hiddenTerminalHost?.getAttribute('data-visible-tab-ids')).toBe('');
    expect(hiddenTerminalHost?.getAttribute('data-focused-pane-id')).toBe('');

    await act(async () => {
      activeChangedListener?.({ tabId: 'tab-1' });
    });
    await flushPromises();

    const revealedTerminalHost = container.querySelector('[data-testid="split-pane"]');
    expect(revealedTerminalHost).toBe(terminalHost);
    expect(revealedTerminalHost?.getAttribute('data-visible-tab-ids')).toBe('tab-1');
  });

  it('links adjacent standalone tabs from the hover gap', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    // Guards the boot sequence: the cached pty-info value must be fetched
    // (initPlatformStore) alongside config/theme init, before any Terminal
    // is constructed -- see spec-fix-terminal-resize-scrollback-loss.md.
    expect(platformSignals.initPlatformStore).toHaveBeenCalled();

    const linkButton = container.querySelector('[aria-label="Link One and Two"]') as HTMLButtonElement | null;
    expect(linkButton).not.toBeNull();
    expect(linkButton?.style.opacity).toBe('0');

    await act(async () => {
      linkButton?.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });

    expect(linkButton?.style.opacity).toBe('1');

    await act(async () => {
      linkButton?.click();
    });
    await flushPromises();

    expect(linkedTabGroups.value).toEqual([['tab-1', 'tab-2']]);
    expect(container.querySelector('[data-testid="split-pane"]')?.textContent).toBe('tab-1|tab-2|tab-1');
    expect(mockTabAPI.switchTo).not.toHaveBeenCalled();
  });

  it('does not remount the terminal area when linking an already-displayed tab into a group', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const beforeLink = container.querySelector('[data-testid="split-pane"]');
    expect(beforeLink).not.toBeNull();
    expect(beforeLink?.textContent).toBe('tab-1|tab-1');

    const linkButton = container.querySelector('[aria-label="Link One and Two"]') as HTMLButtonElement | null;
    expect(linkButton).not.toBeNull();

    await act(async () => {
      linkButton?.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });

    await act(async () => {
      linkButton?.click();
    });
    await flushPromises();

    const afterLink = container.querySelector('[data-testid="split-pane"]');
    // Same DOM node instance -- proves App.tsx never switched component type
    // (bare TerminalView -> SplitPane) across the link transition, so the
    // real TerminalView/xterm.js instance inside it would have survived too.
    expect(afterLink).toBe(beforeLink);
    expect(afterLink?.textContent).toBe('tab-1|tab-2|tab-1');
  });

  it('reorders standalone tabs by drag and drop', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const sourceTab = container.querySelector('[data-tab-id="tab-3"]') as HTMLDivElement | null;
    const targetTab = container.querySelector('[data-tab-id="tab-1"]') as HTMLDivElement | null;

    expect(sourceTab).not.toBeNull();
    expect(targetTab).not.toBeNull();

    await act(async () => {
      dispatchDragEvent(sourceTab, 'dragstart');
    });
    await flushPromises();

    await act(async () => {
      dispatchDragEvent(targetTab, 'dragenter');
      dispatchDragEvent(targetTab, 'dragover');
      dispatchDragEvent(targetTab, 'drop');
      dispatchDragEvent(sourceTab, 'dragend');
    });
    await flushPromises();

    expect(mockTabAPI.reorder).toHaveBeenCalledWith(['tab-3', 'tab-1', 'tab-2']);

    const renderedTabs = Array.from(container.querySelectorAll('[data-tab-id]'))
      .map((element) => element.getAttribute('data-tab-id'));

    expect(renderedTabs).toEqual(['tab-3', 'tab-1', 'tab-2']);
  });

  it('drags a linked group as one visible item', async () => {
    linkedTabGroups.value = [['tab-1', 'tab-2']];

    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const draggedGroupTab = container.querySelector('[data-tab-id="tab-2"]') as HTMLDivElement | null;
    const targetTab = container.querySelector('[data-tab-id="tab-3"]') as HTMLDivElement | null;

    expect(draggedGroupTab).not.toBeNull();
    expect(targetTab).not.toBeNull();

    await act(async () => {
      dispatchDragEvent(draggedGroupTab, 'dragstart');
    });
    await flushPromises();

    await act(async () => {
      dispatchDragEvent(targetTab, 'dragenter');
      dispatchDragEvent(targetTab, 'dragover');
      dispatchDragEvent(targetTab, 'drop');
      dispatchDragEvent(draggedGroupTab, 'dragend');
    });
    await flushPromises();

    expect(mockTabAPI.reorder).toHaveBeenCalledWith(['tab-3', 'tab-1', 'tab-2']);
    expect(container.querySelector('[data-testid="split-pane"]')?.textContent).toBe('tab-1|tab-2|tab-1');
  });

  it('extends an existing linked group with an adjacent standalone tab', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const firstLinkButton = container.querySelector('[aria-label="Link One and Two"]') as HTMLButtonElement | null;

    expect(firstLinkButton).not.toBeNull();

    await act(async () => {
      firstLinkButton?.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });

    await act(async () => {
      firstLinkButton?.click();
    });
    await flushPromises();

    const extendLinkButton = container.querySelector('[aria-label="Link Two and Three"]') as HTMLButtonElement | null;

    expect(extendLinkButton).not.toBeNull();
    expect(extendLinkButton?.style.opacity).toBe('0');

    await act(async () => {
      extendLinkButton?.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });

    expect(extendLinkButton?.style.opacity).toBe('1');

    await act(async () => {
      extendLinkButton?.click();
    });
    await flushPromises();

    expect(linkedTabGroups.value).toEqual([['tab-1', 'tab-2', 'tab-3']]);
    expect(container.querySelector('[data-testid="split-pane"]')?.textContent).toBe('tab-1|tab-2|tab-3|tab-1');
    expect(mockTabAPI.switchTo).not.toHaveBeenCalled();
  });

  it('uses the focused pane for Ctrl+Shift+D inside a linked group', async () => {
    const splitTab = {
      id: 'tab-4',
      manualName: 'Four',
      shellType: 'pwsh',
      status: 'running',
      color: '#f7768e',
      createdAt: 4,
    };

    linkedTabGroups.value = [['tab-1', 'tab-2']];
    focusedPaneTabId.value = 'tab-2';
    mockTabAPI.createSplit.mockResolvedValue({ splitTabId: 'tab-4' });
    mockTabAPI.list.mockReset();
    mockTabAPI.list
      .mockResolvedValueOnce(tabs)
      .mockResolvedValueOnce([...tabs, splitTab])
      .mockResolvedValueOnce([...tabs, splitTab]);

    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'D',
      }));
    });
    await flushPromises();

    expect(mockTabAPI.createSplit).toHaveBeenCalledWith('tab-2', undefined);
    expect(linkedTabGroups.value).toEqual([['tab-1', 'tab-2', 'tab-4']]);
  });

  it('removes a closed tab from the active linked group before re-rendering panes', async () => {
    const tabsWithFour = [
      ...tabs,
      { id: 'tab-4', manualName: 'Four', shellType: 'pwsh', status: 'running', color: '#f7768e', createdAt: 4 },
    ];

    linkedTabGroups.value = [['tab-3', 'tab-4']];
    focusedPaneTabId.value = 'tab-4';
    mockTabAPI.list.mockReset();
    mockTabAPI.list
      .mockResolvedValueOnce(tabsWithFour)
      .mockResolvedValueOnce(tabs);

    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    expect(activeChangedListener).not.toBeNull();

    await act(async () => {
      activeChangedListener?.({ tabId: 'tab-3' });
    });
    await flushPromises();

    const beforeDisconnect = container.querySelector('[data-testid="split-pane"]');
    expect(beforeDisconnect?.textContent).toBe('tab-3|tab-4|tab-4');
    expect(beforeDisconnect?.getAttribute('data-terminal-tab-ids')).toBe('tab-1|tab-2|tab-3|tab-4');

    await act(async () => {
      closedListener?.({ tabId: 'tab-4' });
    });
    await flushPromises();

    expect(linkedTabGroups.value).toEqual([]);
    const afterDisconnect = container.querySelector('[data-testid="split-pane"]');
    // Same DOM node instance across the group-shrinks-to-one transition --
    // proves App.tsx keeps rendering through SplitPane on disconnect too,
    // so the real TerminalView/xterm.js instance inside it would survive.
    expect(afterDisconnect).toBe(beforeDisconnect);
    expect(afterDisconnect?.textContent).toBe('tab-3|tab-3');
    expect(afterDisconnect?.getAttribute('data-terminal-tab-ids')).toBe('tab-1|tab-2|tab-3');
  });

  it('refreshes the tab list when the active tab was created outside the renderer flow', async () => {
    const explorerTab = {
      id: 'tab-4',
      manualName: 'Explorer',
      shellType: 'pwsh',
      status: 'running',
      color: '#f7768e',
      createdAt: 4,
    };

    mockTabAPI.list.mockReset();
    mockTabAPI.list
      .mockResolvedValueOnce(tabs)
      .mockResolvedValueOnce([...tabs, explorerTab]);

    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    expect(activeChangedListener).not.toBeNull();

    await act(async () => {
      activeChangedListener?.({ tabId: 'tab-4' });
    });
    await flushPromises();

    expect(mockTabAPI.list).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="split-pane"]')?.textContent).toBe('tab-4|tab-4');
  });

  it('opens settings from the inline gear button', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    const settingsButton = container.querySelector('[aria-label="Open settings"]') as HTMLDivElement;

    await act(async () => {
      settingsButton.click();
    });

    expect(mockWindowAPI.openSettings).toHaveBeenCalledTimes(1);
  });

  it('opens settings on Ctrl+,', async () => {
    await act(async () => {
      render(<App />, container);
    });
    await flushPromises();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        ctrlKey: true,
        key: ',',
      }));
    });

    expect(mockWindowAPI.openSettings).toHaveBeenCalledTimes(1);
  });
});