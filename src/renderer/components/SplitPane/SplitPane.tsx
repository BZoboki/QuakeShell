import { TerminalView } from '../Terminal/TerminalView';
import styles from './SplitPane.module.css';

interface SplitPaneProps {
  tabIds: string[];
  visibleTabIds: string[];
  onFocusPane: (tabId: string) => void;
  focusedPaneTabId: string | null;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
}

export default function SplitPane({
  tabIds,
  visibleTabIds,
  onFocusPane,
  focusedPaneTabId,
  opacity,
  fontSize,
  fontFamily,
  lineHeight,
}: SplitPaneProps) {
  const paneWidth = visibleTabIds.length > 0
    ? `calc((100% - ${(visibleTabIds.length - 1) * 2}px) / ${visibleTabIds.length})`
    : '0px';
  const visiblePaneIndexes = new Map(
    visibleTabIds.map((tabId, index) => [tabId, index]),
  );

  return (
    <div class={`${styles.container} ${visibleTabIds.length === 0 ? styles.inactiveContainer : ''}`}>
      {tabIds.map((tabId) => {
        const visibleIndex = visiblePaneIndexes.get(tabId);
        const isVisible = visibleIndex !== undefined;

        return (
          <div
            key={`pane-${tabId}`}
            class={`${styles.pane} ${isVisible ? '' : styles.inactivePane}`}
            style={{
              flexBasis: isVisible ? paneWidth : '0px',
              order: isVisible ? visibleIndex * 2 : visibleTabIds.length * 2,
            }}
            aria-hidden={!isVisible}
            onFocusCapture={isVisible ? () => onFocusPane(tabId) : undefined}
          >
            <TerminalView
              tabId={tabId}
              isVisible={isVisible}
              isFocused={isVisible && focusedPaneTabId === tabId}
              opacity={opacity}
              fontSize={fontSize}
              fontFamily={fontFamily}
              lineHeight={lineHeight}
            />
          </div>
        );
      })}
      {visibleTabIds.slice(0, -1).map((tabId, index) => (
        <div
          key={`divider-${tabId}-${visibleTabIds[index + 1]}`}
          class={styles.divider}
          style={{ order: index * 2 + 1 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
