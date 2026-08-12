import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import ThemeStyleInjector from './ThemeStyleInjector';
import { initThemeStore } from '../state/theme-store';
import { ShellPicker } from './ShellPicker/ShellPicker';
import OnboardingOverlay from './Onboarding/OnboardingOverlay';
import UpdateRestartPrompt from './UpdateRestartPrompt';
import ResizeHandle from './ResizeHandle/ResizeHandle';
import SplitPane from './SplitPane';
// eslint-disable-next-line import/no-unresolved
import SettingsPanel from './SettingsPanel';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  opacity as opacitySignal,
  fontSize as fontSizeSignal,
  fontFamily as fontFamilySignal,
  lineHeight as lineHeightSignal,
  initConfigStore,
} from '../state/config-store';
import {
  canLinkTabs,
  focusedPaneTabId,
  createSplit,
  getSplitPrimary,
  getTabGroup,
  linkExistingTabs,
  disconnectTabGroupAt,
  removeTabFromGroups,
} from '../state/tab-store';

interface TabInfo {
  id: string;
  shellType?: string;
  status?: string;
  color?: string;
  manualName?: string;
}

type VisibleTabItem =
  | { kind: 'single'; leadTabId: string; tabs: [TabInfo] }
  | { kind: 'group'; leadTabId: string; tabs: TabInfo[] };

function buildVisibleTabItems(tabList: TabInfo[]): VisibleTabItem[] {
  const visibleTabItems: VisibleTabItem[] = [];
  const renderedTabIds = new Set<string>();

  for (const tab of tabList) {
    if (renderedTabIds.has(tab.id)) continue;

    const groupIds = getTabGroup(tab.id);
    if (groupIds) {
      const groupTabs = groupIds
        .map((groupTabId) => tabList.find((candidate) => candidate.id === groupTabId))
        .filter((candidate): candidate is TabInfo => candidate !== undefined);

      if (groupTabs.length > 1) {
        for (const groupTab of groupTabs) {
          renderedTabIds.add(groupTab.id);
        }

        visibleTabItems.push({
          kind: 'group',
          leadTabId: groupTabs[0].id,
          tabs: groupTabs,
        });
        continue;
      }
    }

    renderedTabIds.add(tab.id);
    visibleTabItems.push({ kind: 'single', leadTabId: tab.id, tabs: [tab] });
  }

  return visibleTabItems;
}

function reorderVisibleTabItems(
  visibleTabItems: VisibleTabItem[],
  sourceLeadTabId: string,
  targetLeadTabId: string,
): string[] | null {
  if (sourceLeadTabId === targetLeadTabId) {
    return null;
  }

  const sourceIndex = visibleTabItems.findIndex((item) => item.leadTabId === sourceLeadTabId);
  const targetIndex = visibleTabItems.findIndex((item) => item.leadTabId === targetLeadTabId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return null;
  }

  const reorderedItems = [...visibleTabItems];
  const [movedItem] = reorderedItems.splice(sourceIndex, 1);

  if (!movedItem) {
    return null;
  }

  reorderedItems.splice(targetIndex, 0, movedItem);
  return reorderedItems.flatMap((item) => item.tabs.map((tab) => tab.id));
}

function resolveNextDisplayedTabId(tabList: TabInfo[], preferredTabId: string | null): string | null {
  if (preferredTabId) {
    const preferredLeadTabId = getSplitPrimary(preferredTabId) ?? preferredTabId;
    if (tabList.some((tab) => tab.id === preferredLeadTabId)) {
      return preferredLeadTabId;
    }
  }

  if (focusedPaneTabId.value) {
    const focusedLeadTabId = getSplitPrimary(focusedPaneTabId.value) ?? focusedPaneTabId.value;
    if (tabList.some((tab) => tab.id === focusedLeadTabId)) {
      return focusedLeadTabId;
    }
  }

  return tabList[0]?.id ?? null;
}

export function App() {
  useReducedMotion();

  const [currentTabId, setCurrentTabId] = useState<string | null>(null);
  const [tabList, setTabList] = useState<TabInfo[]>([]);
  const [hoveredLinkGap, setHoveredLinkGap] = useState<string | null>(null);
  const [draggedLeadTabId, setDraggedLeadTabId] = useState<string | null>(null);
  const [dragOverLeadTabId, setDragOverLeadTabId] = useState<string | null>(null);
  const [currentOpacity, setCurrentOpacity] = useState(0.85);
  const [currentFontSize, setCurrentFontSize] = useState(14);
  const [currentFontFamily, setCurrentFontFamily] = useState('monospace');
  const [currentLineHeight, setCurrentLineHeight] = useState(1.2);
  const tabListRef = useRef<TabInfo[]>([]);

  useEffect(() => {
    tabListRef.current = tabList;
  }, [tabList]);

  const refreshTabs = useCallback(() => {
    window.quakeshell.tab.list()
      .then((list: TabInfo[]) => {
        setTabList(list);
        setCurrentTabId((previousTabId) => resolveNextDisplayedTabId(list, previousTabId));
      })
      .catch((err: unknown) => console.error('[App] tab.list() failed:', err));
  }, []);

  // Tab keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;

      // Only trust focusedPaneTabId if it's actually a member of the
      // currently displayed tab's group -- it can go stale (e.g. after
      // switching tabs without ever focusing a pane in the new tab), and a
      // stale value must not steal keyboard shortcuts meant for currentTabId.
      const currentLeadTabId = currentTabId ? getSplitPrimary(currentTabId) ?? currentTabId : null;
      const currentGroupTabIds = currentLeadTabId
        ? (getTabGroup(currentLeadTabId) ?? [currentLeadTabId])
        : [];
      const keyboardTargetTabId = currentGroupTabIds.includes(focusedPaneTabId.value ?? '')
        ? focusedPaneTabId.value ?? currentTabId
        : currentTabId;

      if (e.key === 't') {
        e.preventDefault();
        handleAddTab();
      } else if (e.key === 'w') {
        e.preventDefault();
        if (keyboardTargetTabId) handleCloseTab(keyboardTargetTabId);
      } else if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        // Next tab
        if (tabList.length > 1 && currentTabId) {
          const idx = tabList.findIndex((t) => t.id === currentTabId);
          const next = tabList[(idx + 1) % tabList.length];
          handleSwitchTab(next.id);
        }
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        // Previous tab
        if (tabList.length > 1 && currentTabId) {
          const idx = tabList.findIndex((t) => t.id === currentTabId);
          const prev = tabList[(idx - 1 + tabList.length) % tabList.length];
          handleSwitchTab(prev.id);
        }
      } else if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (tabIndex < tabList.length) {
          handleSwitchTab(tabList[tabIndex].id);
        }
      } else if (e.shiftKey && e.key === 'D') {
        e.preventDefault();
        if (!keyboardTargetTabId) return;
        createSplit(keyboardTargetTabId).then((splitTabId) => {
          if (splitTabId) {
            focusedPaneTabId.value = splitTabId;
            refreshTabs();
          }
        });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentTabId, tabList]);

  useEffect(() => {
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        window.quakeshell.window.openSettings()
          .catch((err: unknown) => console.error('[App] window.openSettings failed:', err));
      }
    };

    document.addEventListener('keydown', handleSettingsShortcut, true);
    return () => document.removeEventListener('keydown', handleSettingsShortcut, true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      initConfigStore(),
      initThemeStore(),
      window.quakeshell.tab.list(),
    ])
      .then(([, , list]) => {
        if (cancelled) {
          return;
        }

        setTabList(list as TabInfo[]);
        if ((list as TabInfo[]).length > 0) {
          setCurrentTabId((list as TabInfo[])[0].id);
        }
      })
      .catch((err: unknown) => console.error('[App] initialization failed:', err));

    // Subscribe to tab events
    const offActive = window.quakeshell.tab.onActiveChanged(
      ({ tabId }: { tabId: string }) => {
        setCurrentTabId(tabId);

        if (!tabListRef.current.some((tab) => tab.id === tabId)) {
          refreshTabs();
        }
      },
    );
    const offClosed = window.quakeshell.tab.onClosed(
      ({ tabId }: { tabId: string }) => {
        removeTabFromGroups(tabId);
        setHoveredLinkGap(null);
        setDraggedLeadTabId((current) => (current === tabId ? null : current));
        setDragOverLeadTabId((current) => (current === tabId ? null : current));
        setTabList((previousTabs) => {
          const nextTabs = previousTabs.filter((tab) => tab.id !== tabId);
          setCurrentTabId((previousTabId) =>
            resolveNextDisplayedTabId(nextTabs, previousTabId === tabId ? null : previousTabId));
          return nextTabs;
        });
        refreshTabs();
      },
    );
    const offRenamed = window.quakeshell.tab.onRenamed(
      () => refreshTabs(),
    );

    // Sync config signals → state
    const disposers = [
      effect(() => setCurrentOpacity(opacitySignal.value)),
      effect(() => setCurrentFontSize(fontSizeSignal.value)),
      effect(() => setCurrentFontFamily(fontFamilySignal.value)),
      effect(() => setCurrentLineHeight(lineHeightSignal.value)),
    ];

    return () => {
      cancelled = true;
      offActive();
      offClosed();
      offRenamed();
      disposers.forEach((d) => d());
    };
  }, [refreshTabs]);

  const handleAddTab = () => {
    window.quakeshell.tab.create({ deferred: true })
      .then((newTab: TabInfo) => {
        setTabList((prev) => [...prev, newTab]);
        setCurrentTabId(newTab.id);
      })
      .catch((err: unknown) => console.error('[App] tab.create failed:', err));
  };

  const handleCloseTab = (id: string) => {
    window.quakeshell.tab.close(id)
      .then(() => {
        refreshTabs();
        // If we closed the active tab, the main process will emit onActiveChanged
      })
      .catch((err: unknown) => console.error('[App] tab.close failed:', err));
  };

  const handleSwitchTab = (id: string) => {
    const clickedGroupLead = getSplitPrimary(id);
    const currentGroupLead = currentTabId
      ? getSplitPrimary(currentTabId) ?? currentTabId
      : null;

    if (clickedGroupLead) {
      if (currentGroupLead === clickedGroupLead) {
        focusedPaneTabId.value = id;
        return;
      }

      focusedPaneTabId.value = id;
      window.quakeshell.tab.switchTo(clickedGroupLead)
        .then(() => setCurrentTabId(clickedGroupLead))
        .catch((err: unknown) => console.error('[App] tab.switchTo failed:', err));
      return;
    }

    focusedPaneTabId.value = null;
    window.quakeshell.tab.switchTo(id)
      .then(() => setCurrentTabId(id))
      .catch((err: unknown) => console.error('[App] tab.switchTo failed:', err));
  };

  const handleLinkTabs = (leftTabId: string, rightTabId: string) => {
    const linked = linkExistingTabs(leftTabId, rightTabId);
    if (!linked) return;

    const mergedGroup = getTabGroup(leftTabId) ?? getTabGroup(rightTabId);
    if (!mergedGroup) return;

    const nextFocusedPaneId =
      currentTabId && mergedGroup.includes(currentTabId)
        ? currentTabId
        : leftTabId;

    focusedPaneTabId.value = nextFocusedPaneId;
    setHoveredLinkGap(null);
    setCurrentTabId(mergedGroup[0]);

    if (currentTabId !== mergedGroup[0]) {
      window.quakeshell.tab.switchTo(mergedGroup[0])
        .catch((err: unknown) => console.error('[App] tab.switchTo failed:', err));
    }
  };

  const handleReorderTabs = useCallback((sourceLeadTabId: string, targetLeadTabId: string) => {
    const nextTabIds = reorderVisibleTabItems(
      buildVisibleTabItems(tabList),
      sourceLeadTabId,
      targetLeadTabId,
    );

    setDraggedLeadTabId(null);
    setDragOverLeadTabId(null);
    setHoveredLinkGap(null);

    if (!nextTabIds) {
      return;
    }

    const nextTabs = nextTabIds
      .map((tabId) => tabList.find((tab) => tab.id === tabId))
      .filter((tab): tab is TabInfo => tab !== undefined);

    if (nextTabs.length !== tabList.length) {
      refreshTabs();
      return;
    }

    setTabList(nextTabs);

    window.quakeshell.tab.reorder(nextTabIds)
      .then((updatedTabs: TabInfo[]) => {
        setTabList(updatedTabs);
        setCurrentTabId((previousTabId) => resolveNextDisplayedTabId(updatedTabs, previousTabId));
      })
      .catch((err: unknown) => {
        console.error('[App] tab.reorder failed:', err);
        refreshTabs();
      });
  }, [refreshTabs, tabList]);

  const handleDisconnectTabs = (leftTabId: string, rightTabId: string) => {
    const originalGroup = getTabGroup(leftTabId);
    if (!originalGroup || !originalGroup.includes(rightTabId)) {
      return;
    }

    const currentGroupLead = currentTabId
      ? getSplitPrimary(currentTabId) ?? currentTabId
      : null;
    const wasCurrentGroupActive = currentGroupLead
      ? originalGroup.includes(currentGroupLead)
      : false;
    const previousFocusedPaneId = focusedPaneTabId.value;
    const previousActiveTabId = currentTabId;

    const result = disconnectTabGroupAt(leftTabId, rightTabId);
    if (!result) {
      return;
    }

    if (!wasCurrentGroupActive) {
      return;
    }

    const nextActivePaneId =
      previousFocusedPaneId
      && (result.leftGroup.includes(previousFocusedPaneId) || result.rightGroup.includes(previousFocusedPaneId))
        ? previousFocusedPaneId
        : previousActiveTabId
          && (result.leftGroup.includes(previousActiveTabId) || result.rightGroup.includes(previousActiveTabId))
          ? previousActiveTabId
          : result.leftGroup[0] ?? result.rightGroup[0] ?? null;

    if (!nextActivePaneId) {
      focusedPaneTabId.value = null;
      return;
    }

    const nextActiveTabId = getSplitPrimary(nextActivePaneId) ?? nextActivePaneId;
    focusedPaneTabId.value = getTabGroup(nextActivePaneId) ? nextActivePaneId : null;
    setCurrentTabId(nextActiveTabId);

    if (previousActiveTabId === nextActiveTabId) {
      return;
    }

    window.quakeshell.tab.switchTo(nextActiveTabId)
      .catch((err: unknown) => console.error('[App] tab.switchTo failed:', err));
  };

  const handleShellSelected = (tabId: string, shellType: string) => {
    window.quakeshell.tab.spawnTab(tabId, shellType)
      .then((updated: TabInfo) => {
        setTabList((prev) =>
          prev.map((t) => (t.id === tabId ? updated : t)),
        );
      })
      .catch((err: unknown) => console.error('[App] tab.spawnTab failed:', err));
  };

  const availableTabIds = new Set(tabList.map((tab) => tab.id));
  const rawDisplayTabId = currentTabId ? getSplitPrimary(currentTabId) ?? currentTabId : null;
  const fallbackDisplayTabId = focusedPaneTabId.value
    ? getSplitPrimary(focusedPaneTabId.value) ?? focusedPaneTabId.value
    : null;
  const displayTabId = rawDisplayTabId && availableTabIds.has(rawDisplayTabId)
    ? rawDisplayTabId
    : fallbackDisplayTabId && availableTabIds.has(fallbackDisplayTabId)
      ? fallbackDisplayTabId
      : null;
  const activeTab = tabList.find((t) => t.id === displayTabId);
  const showPicker = activeTab?.status === 'pending';
  const currentGroupTabIds = displayTabId
    ? (getTabGroup(displayTabId) ?? [displayTabId]).filter((tabId) => availableTabIds.has(tabId))
    : [];
  const currentFocusedPane = currentGroupTabIds.includes(focusedPaneTabId.value ?? '')
    ? focusedPaneTabId.value ?? displayTabId
    : displayTabId;
  const visibleTabItems = buildVisibleTabItems(tabList);
  const getTabLabel = (tab: TabInfo) =>
    tab.manualName || (tab.status === 'pending' ? 'New Tab' : tab.shellType) || 'shell';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ThemeStyleInjector />

      {/* Tab bar — fully inline, no child components */}
      <div
        style={{
          width: '100%',
          height: '32px',
          minHeight: '32px',
          flexShrink: 0,
          backgroundColor: currentOpacity >= 1
            ? 'var(--bg-chrome)'
            : `color-mix(in srgb, var(--bg-chrome) ${currentOpacity * 100}%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px',
          gap: '2px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '12px',
          userSelect: 'none',
          borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)',
        }}
      >
        {/* Tab items — split pairs grouped visually */}
        {visibleTabItems.flatMap((item, index) => {
            const elements: preact.ComponentChildren[] = [];
            const showDropTarget = dragOverLeadTabId === item.leadTabId && draggedLeadTabId !== item.leadTabId;
            const commonDropTargetProps = {
              onDragEnter: (e: DragEvent) => {
                if (!draggedLeadTabId || draggedLeadTabId === item.leadTabId) return;
                e.preventDefault();
                setDragOverLeadTabId(item.leadTabId);
              },
              onDragOver: (e: DragEvent) => {
                if (!draggedLeadTabId || draggedLeadTabId === item.leadTabId) return;
                e.preventDefault();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'move';
                }
                if (dragOverLeadTabId !== item.leadTabId) {
                  setDragOverLeadTabId(item.leadTabId);
                }
              },
              onDrop: (e: DragEvent) => {
                if (!draggedLeadTabId || draggedLeadTabId === item.leadTabId) return;
                e.preventDefault();
                handleReorderTabs(draggedLeadTabId, item.leadTabId);
              },
            };

            if (item.kind === 'group') {
              const groupLead = item.leadTabId;
              const groupActive = displayTabId === groupLead;

              const renderGroupTab = (tab: TabInfo, tabIndex: number) => {
                const label = getTabLabel(tab);
                const tabColor = tab.color || '#7aa2f7';
                const isFocused = groupActive && currentFocusedPane === tab.id;
                const isFirst = tabIndex === 0;
                const isLast = tabIndex === item.tabs.length - 1;

                return (
                  <div
                    key={`group-tab-${tab.id}`}
                    onClick={() => handleSwitchTab(tab.id)}
                    data-tab-id={tab.id}
                    draggable={tab.status !== 'pending'}
                    onDragStart={(e: DragEvent) => {
                      setDraggedLeadTabId(groupLead);
                      setHoveredLinkGap(null);
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', groupLead);
                      }
                    }}
                    onDragEnd={() => {
                      setDraggedLeadTabId(null);
                      setDragOverLeadTabId(null);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '0 10px',
                      height: '100%',
                      minWidth: 0,
                      cursor: 'pointer',
                      opacity: draggedLeadTabId === groupLead ? 0.7 : 1,
                      backgroundColor: isFocused
                        ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                        : 'transparent',
                      borderRadius: isFirst ? '5px 0 0 5px' : isLast ? '0 5px 5px 0' : '0',
                    }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: tabColor, flexShrink: 0 }} />
                    <span style={{ color: groupActive ? 'var(--fg-primary)' : 'color-mix(in srgb, var(--fg-primary) 70%, var(--fg-dimmed) 30%)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px', fontSize: '12px' }}>{label}</span>
                    <span onClick={(e: MouseEvent) => { e.stopPropagation(); handleCloseTab(tab.id); }} style={{ color: 'var(--fg-dimmed)', cursor: 'pointer', fontSize: '14px', lineHeight: '1', marginLeft: '2px' }}>×</span>
                  </div>
                );
              };

              elements.push(
                <div
                  key={`group-${groupLead}`}
                  data-tab-group-lead={groupLead}
                  {...commonDropTargetProps}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: '26px',
                    border: groupActive
                      ? '1px solid var(--accent)'
                      : '1px solid color-mix(in srgb, var(--border) 80%, var(--bg-chrome) 20%)',
                    boxShadow: showDropTarget
                      ? '0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)'
                      : 'none',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    backgroundColor: groupActive
                      ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                      : 'color-mix(in srgb, var(--bg-terminal) 40%, transparent)',
                  }}
                >
                  {item.tabs.flatMap((tab, tabIndex) => {
                    const nextTab = item.tabs[tabIndex + 1];
                    const groupElements = [renderGroupTab(tab, tabIndex)];

                    if (nextTab) {
                      groupElements.push(
                        <button
                          key={`disconnect-${tab.id}-${nextTab.id}`}
                          type="button"
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation();
                            handleDisconnectTabs(tab.id, nextTab.id);
                          }}
                          aria-label={`Disconnect ${getTabLabel(tab)} and ${getTabLabel(nextTab)}`}
                          title="Disconnect linked tabs"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '22px',
                            height: '100%',
                            flexShrink: 0,
                            border: 'none',
                            borderLeft: '1px solid color-mix(in srgb, var(--fg-dimmed) 30%, transparent)',
                            borderRight: '1px solid color-mix(in srgb, var(--fg-dimmed) 30%, transparent)',
                            background: 'transparent',
                            padding: 0,
                            cursor: 'pointer',
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={groupActive ? 'var(--accent)' : 'var(--fg-dimmed)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>,
                      );
                    }

                    return groupElements;
                  })}
                </div>,
              );
            } else {
              const tab = item.tabs[0];
              const isActive = tab.id === displayTabId;
              const label = getTabLabel(tab);
              const tabColor = tab.color || '#7aa2f7';

              elements.push(
                <div
                  key={tab.id}
                  onClick={() => handleSwitchTab(tab.id)}
                  data-tab-id={tab.id}
                  draggable={tab.status !== 'pending'}
                  onDragStart={(e: DragEvent) => {
                    setDraggedLeadTabId(tab.id);
                    setHoveredLinkGap(null);
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', tab.id);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedLeadTabId(null);
                    setDragOverLeadTabId(null);
                  }}
                  {...commonDropTargetProps}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '0 10px',
                    height: '26px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    opacity: draggedLeadTabId === tab.id ? 0.7 : 1,
                    backgroundColor: isActive
                      ? 'color-mix(in srgb, var(--accent) 15%, transparent)'
                      : 'transparent',
                    borderBottom: isActive ? `2px solid ${tabColor}` : '2px solid transparent',
                    boxShadow: showDropTarget
                      ? 'inset 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)'
                      : 'none',
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: tabColor, flexShrink: 0 }} />
                  <span style={{ color: isActive ? 'var(--fg-primary)' : 'var(--fg-dimmed)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{label}</span>
                  <span onClick={(e: MouseEvent) => { e.stopPropagation(); handleCloseTab(tab.id); }} style={{ color: 'var(--fg-dimmed)', cursor: 'pointer', fontSize: '14px', lineHeight: '1', marginLeft: '4px' }}>×</span>
                </div>,
              );
            }

            const nextItem = visibleTabItems[index + 1];
            if (nextItem) {
              const leftTab = item.tabs[item.tabs.length - 1];
              const rightTab = nextItem.tabs[0];
              const gapKey = `${leftTab.id}:${rightTab.id}`;
              const linkable =
                leftTab.status !== 'pending'
                && rightTab.status !== 'pending'
                && canLinkTabs(leftTab.id, rightTab.id);
              const showLinkButton = draggedLeadTabId === null && hoveredLinkGap === gapKey && linkable;

              elements.push(
                <div
                  key={`gap-${gapKey}`}
                  onMouseEnter={() => {
                    if (linkable) setHoveredLinkGap(gapKey);
                  }}
                  onMouseLeave={() => {
                    setHoveredLinkGap((current) => (current === gapKey ? null : current));
                  }}
                  style={{
                    position: 'relative',
                    width: linkable ? '14px' : '0px',
                    height: '26px',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'visible',
                    marginLeft: linkable ? '-4px' : '0px',
                    marginRight: linkable ? '-4px' : '0px',
                    zIndex: showLinkButton ? 3 : 1,
                    cursor: linkable ? 'pointer' : 'default',
                  }}
                >
                  {linkable && (
                    <button
                      type="button"
                      aria-label={`Link ${getTabLabel(leftTab)} and ${getTabLabel(rightTab)}`}
                      title="Link tabs"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        handleLinkTabs(leftTab.id, rightTab.id);
                      }}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: `translate(-50%, -50%) scale(${showLinkButton ? '1' : '0.9'})`,
                        opacity: showLinkButton ? 1 : 0,
                        pointerEvents: showLinkButton ? 'auto' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '20px',
                        height: '20px',
                        padding: 0,
                        borderRadius: '999px',
                        border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
                        background: 'color-mix(in srgb, var(--bg-chrome) 96%, transparent)',
                        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.35)',
                        cursor: 'pointer',
                        transition: 'opacity 120ms ease, transform 120ms ease',
                        zIndex: 2,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            }

            return elements;
          })}

        {/* Add tab button */}
        <div
          onClick={handleAddTab}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--fg-dimmed)',
            fontSize: '16px',
          }}
        >
          +
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Settings button */}
        <div
          onClick={() => {
            window.quakeshell.window.openSettings()
              .catch((err: unknown) => console.error('[App] window.openSettings failed:', err));
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '26px',
            height: '26px',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'color-mix(in srgb, var(--fg-primary) 70%, var(--fg-dimmed) 30%)',
            fontSize: '16px',
            opacity: 0.7,
            transition: 'opacity 150ms',
          }}
          title="Settings (Ctrl+,)"
          aria-label="Open settings"
        >
          ⚙
        </div>
      </div>

      {/* Terminal / Shell Picker */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {displayTabId && showPicker && (
          <ShellPicker
            tabId={displayTabId}
            opacity={currentOpacity}
            onShellSelected={handleShellSelected}
          />
        )}
        {/*
          SplitPane now renders every displayed tab, not just linked groups --
          for an ungrouped tab it renders a single full-width pane with no
          divider, so the component type stays the same across link/disconnect
          transitions and xterm.js instances are never remounted.
        */}
        {displayTabId && !showPicker && currentGroupTabIds.length > 0 && currentFocusedPane && (
          <SplitPane
            tabIds={currentGroupTabIds}
            focusedPaneTabId={currentFocusedPane}
            onFocusPane={(id) => { focusedPaneTabId.value = id; }}
            opacity={currentOpacity}
            fontSize={currentFontSize}
            fontFamily={currentFontFamily}
            lineHeight={currentLineHeight}
          />
        )}
      </div>
      <SettingsPanel />
      <ResizeHandle opacity={currentOpacity} />
      <UpdateRestartPrompt />
      <OnboardingOverlay />
    </div>
  );
}
