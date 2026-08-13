// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const terminalLifecycle = vi.hoisted(() => ({
  nextInstanceId: 0,
  mountedTabIds: [] as string[],
  unmountedTabIds: [] as string[],
}));

vi.mock('../Terminal/TerminalView', async () => {
  const { Component } = await vi.importActual<typeof import('preact')>('preact');

  interface MockTerminalViewProps {
    tabId: string;
    isVisible: boolean;
    isFocused: boolean;
  }

  class MockTerminalView extends Component<MockTerminalViewProps> {
    private readonly instanceId = ++terminalLifecycle.nextInstanceId;

    componentDidMount() {
      terminalLifecycle.mountedTabIds.push(this.props.tabId);
    }

    componentWillUnmount() {
      terminalLifecycle.unmountedTabIds.push(this.props.tabId);
    }

    render() {
      const { tabId, isVisible, isFocused } = this.props;

      return (
        <div
          data-testid={`terminal-${tabId}`}
          data-instance-id={this.instanceId}
          data-visible={String(isVisible)}
          data-focused={String(isFocused)}
        />
      );
    }
  }

  return { TerminalView: MockTerminalView };
});

vi.mock('./SplitPane.module.css', () => ({
  default: {
    container: 'container',
    inactiveContainer: 'inactiveContainer',
    pane: 'pane',
    inactivePane: 'inactivePane',
    divider: 'divider',
  },
}));

import SplitPane from './SplitPane';

describe('SplitPane', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    terminalLifecycle.nextInstanceId = 0;
    terminalLifecycle.mountedTabIds.length = 0;
    terminalLifecycle.unmountedTabIds.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
  });

  it('renders a TerminalView for each linked tab', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2', 'tab-3']}
          visibleTabIds={['tab-1', 'tab-2', 'tab-3']}
          focusedPaneTabId="tab-2"
          onFocusPane={vi.fn()}
          opacity={0.85}
          fontSize={14}
          fontFamily="monospace"
        />,
        container,
      );
    });

    expect(container.querySelector('[data-testid="terminal-tab-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="terminal-tab-2"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="terminal-tab-3"]')).toBeTruthy();
  });

  it('renders a static divider placeholder between each pane', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2', 'tab-3']}
          visibleTabIds={['tab-1', 'tab-2', 'tab-3']}
          focusedPaneTabId="tab-1"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    const panes = container.querySelectorAll('[class*="pane"]');
    expect(panes.length).toBe(3);

    const dividers = container.querySelectorAll('[class*="divider"]');
    expect(dividers.length).toBe(2);
    expect(dividers[0]?.getAttribute('aria-hidden')).toBe('true');
    expect((dividers[0] as HTMLElement).style.order).toBe('1');
    expect((dividers[1] as HTMLElement).style.order).toBe('3');
  });

  it('calls onFocusPane when a pane receives focus', async () => {
    const onFocusPane = vi.fn();

    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2', 'tab-3']}
          visibleTabIds={['tab-1', 'tab-2', 'tab-3']}
          focusedPaneTabId="tab-1"
          onFocusPane={onFocusPane}
        />,
        container,
      );
    });

    const panes = container.querySelectorAll('[class*="pane"]');
    // onFocusCapture listens for the 'focus' event in capture phase
    await act(async () => {
      panes[2].dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    });

    expect(onFocusPane).toHaveBeenCalledWith('tab-3');
  });

  it('sets each pane to an equal share of the container width', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2', 'tab-3']}
          visibleTabIds={['tab-1', 'tab-2', 'tab-3']}
          focusedPaneTabId="tab-1"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    const panes = container.querySelectorAll('[class*="pane"]') as NodeListOf<HTMLElement>;
    expect(panes[0].style.flexBasis).toBe(panes[1].style.flexBasis);
    expect(panes[1].style.flexBasis).toBe(panes[2].style.flexBasis);
    expect(panes[0].style.flexBasis).toContain('100% - 4px');
  });

  it('sizes panes from the visible set rather than the persistent set', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2', 'tab-3']}
          visibleTabIds={['tab-2']}
          focusedPaneTabId="tab-2"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    const hiddenPane = container.querySelector('[data-testid="terminal-tab-1"]')?.parentElement;
    const visiblePane = container.querySelector('[data-testid="terminal-tab-2"]')?.parentElement;

    expect(hiddenPane?.style.flexBasis).toBe('0px');
    expect(visiblePane?.style.flexBasis).toContain('100%');
    expect(visiblePane?.style.flexBasis).toContain('0px');
    expect(container.querySelectorAll('[class*="divider"]')).toHaveLength(0);
  });

  it('keeps terminals mounted while no panes are visible', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1', 'tab-2']}
          visibleTabIds={[]}
          focusedPaneTabId={null}
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    expect(container.firstElementChild?.classList.contains('inactiveContainer')).toBe(true);
    expect(container.querySelector('[data-testid="terminal-tab-1"]')?.getAttribute('data-visible')).toBe('false');
    expect(container.querySelector('[data-testid="terminal-tab-2"]')?.getAttribute('data-visible')).toBe('false');
    expect(terminalLifecycle.mountedTabIds).toEqual(['tab-1', 'tab-2']);
    expect(terminalLifecycle.unmountedTabIds).toEqual([]);
  });

  it('moves focused state without recreating visible terminals', async () => {
    const renderFocusedPane = async (focusedPaneTabId: string) => {
      await act(async () => {
        render(
          <SplitPane
            tabIds={['tab-1', 'tab-2']}
            visibleTabIds={['tab-1', 'tab-2']}
            focusedPaneTabId={focusedPaneTabId}
            onFocusPane={vi.fn()}
          />,
          container,
        );
      });
    };

    await renderFocusedPane('tab-1');
    const tabOne = container.querySelector('[data-testid="terminal-tab-1"]');
    const tabTwo = container.querySelector('[data-testid="terminal-tab-2"]');
    expect(tabOne?.getAttribute('data-focused')).toBe('true');
    expect(tabTwo?.getAttribute('data-focused')).toBe('false');

    await renderFocusedPane('tab-2');
    expect(container.querySelector('[data-testid="terminal-tab-1"]')).toBe(tabOne);
    expect(container.querySelector('[data-testid="terminal-tab-2"]')).toBe(tabTwo);
    expect(tabOne?.getAttribute('data-focused')).toBe('false');
    expect(tabTwo?.getAttribute('data-focused')).toBe('true');
  });

  it('renders a single full-width pane with no divider for one tab', async () => {
    const onFocusPane = vi.fn();

    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-1']}
          visibleTabIds={['tab-1']}
          focusedPaneTabId="tab-1"
          onFocusPane={onFocusPane}
        />,
        container,
      );
    });

    expect(container.querySelector('[data-testid="terminal-tab-1"]')).toBeTruthy();

    const panes = container.querySelectorAll('[class*="pane"]') as NodeListOf<HTMLElement>;
    expect(panes.length).toBe(1);
    // Resolves to full width with no divider width subtracted -- same
    // visual result as the pre-fix bare-TerminalView render.
    expect(panes[0].style.flexBasis).toContain('100%');
    expect(panes[0].style.flexBasis).toContain('0px');

    const dividers = container.querySelectorAll('[class*="divider"]');
    expect(dividers.length).toBe(0);

    await act(async () => {
      panes[0].dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    });

    expect(onFocusPane).toHaveBeenCalledWith('tab-1');
  });

  it('preserves both terminal instances when a hidden tab is prepended to the visible split', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-a', 'tab-b']}
          visibleTabIds={['tab-b']}
          focusedPaneTabId="tab-b"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    const beforeTabA = container.querySelector('[data-testid="terminal-tab-a"]');
    const beforeTabB = container.querySelector('[data-testid="terminal-tab-b"]');
    expect(beforeTabA?.getAttribute('data-visible')).toBe('false');
    expect(beforeTabB?.getAttribute('data-visible')).toBe('true');

    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-a', 'tab-b']}
          visibleTabIds={['tab-a', 'tab-b']}
          focusedPaneTabId="tab-b"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    expect(container.querySelector('[data-testid="terminal-tab-a"]')).toBe(beforeTabA);
    expect(container.querySelector('[data-testid="terminal-tab-b"]')).toBe(beforeTabB);
    expect(terminalLifecycle.mountedTabIds).toEqual(['tab-a', 'tab-b']);
    expect(terminalLifecycle.unmountedTabIds).toEqual([]);
  });

  it('keeps terminal identities stable across extend, switch, and disconnect transitions', async () => {
    const renderSplit = async (visibleTabIds: string[]) => {
      await act(async () => {
        render(
          <SplitPane
            tabIds={['tab-a', 'tab-b', 'tab-c']}
            visibleTabIds={visibleTabIds}
            focusedPaneTabId={visibleTabIds.at(-1) ?? null}
            onFocusPane={vi.fn()}
          />,
          container,
        );
      });
    };

    await renderSplit(['tab-a']);
    const originalNodes = new Map(
      ['tab-a', 'tab-b', 'tab-c'].map((tabId) => [
        tabId,
        container.querySelector(`[data-testid="terminal-${tabId}"]`),
      ]),
    );

    await renderSplit(['tab-a', 'tab-b']);
    await renderSplit(['tab-a', 'tab-b', 'tab-c']);
    await renderSplit(['tab-c']);
    await renderSplit(['tab-b', 'tab-c']);

    for (const [tabId, originalNode] of originalNodes) {
      expect(container.querySelector(`[data-testid="terminal-${tabId}"]`)).toBe(originalNode);
    }
    expect(terminalLifecycle.mountedTabIds).toEqual(['tab-a', 'tab-b', 'tab-c']);
    expect(terminalLifecycle.unmountedTabIds).toEqual([]);
    expect(container.querySelectorAll('[class*="divider"]')).toHaveLength(1);
  });

  it('unmounts only the terminal removed from the persistent tab set', async () => {
    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-a', 'tab-b', 'tab-c']}
          visibleTabIds={['tab-a', 'tab-b']}
          focusedPaneTabId="tab-a"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    const tabANode = container.querySelector('[data-testid="terminal-tab-a"]');
    const tabCNode = container.querySelector('[data-testid="terminal-tab-c"]');

    await act(async () => {
      render(
        <SplitPane
          tabIds={['tab-a', 'tab-c']}
          visibleTabIds={['tab-a']}
          focusedPaneTabId="tab-a"
          onFocusPane={vi.fn()}
        />,
        container,
      );
    });

    expect(terminalLifecycle.unmountedTabIds).toEqual(['tab-b']);
    expect(container.querySelector('[data-testid="terminal-tab-a"]')).toBe(tabANode);
    expect(container.querySelector('[data-testid="terminal-tab-c"]')).toBe(tabCNode);
  });
});
