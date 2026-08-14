import { useCallback, useEffect, useRef } from 'preact/hooks';
import { activeSettingsTab, closeSettings, isSettingsOpen } from '../../state/settings-store';
import { SETTINGS_TABS, SETTINGS_TAB_LABELS } from './SettingsTabs';
import GeneralSettings from './GeneralSettings';
import AppearanceSettings from './AppearanceSettings';
import ThemesSettings from './ThemesSettings';
import KeyboardSettings from './KeyboardSettings';
import DistributionSettings from './DistributionSettings';
import UpdateSettings from './UpdateSettings';
import styles from './SettingsPanel.module.css';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('disabled'));
}

function renderSettingsContent() {
  switch (activeSettingsTab.value) {
    case 'appearance':
      return <AppearanceSettings />;
    case 'themes':
      return <ThemesSettings />;
    case 'keyboard':
      return <KeyboardSettings />;
    case 'distribution':
      return <DistributionSettings />;
    case 'updates':
      return <UpdateSettings />;
    case 'general':
    default:
      return <GeneralSettings />;
  }
}

interface SettingsPanelProps {
  standalone?: boolean;
}

export default function SettingsPanel({ standalone = false }: SettingsPanelProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const panelVisible = standalone || isSettingsOpen.value;
  const handleClose = useCallback(() => {
    if (standalone) {
      void window.quakeshell.window.closeSettings();
      return;
    }

    closeSettings();
  }, [standalone]);

  useEffect(() => {
    if (!panelVisible) {
      return undefined;
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [handleClose, panelVisible]);

  useEffect(() => {
    if (!panelVisible) {
      return undefined;
    }

    const card = cardRef.current;
    if (!card) {
      return undefined;
    }

    const focusable = getFocusableElements(card);
    focusable[0]?.focus();

    const handleTabTrap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements(card);
      if (focusableElements.length === 0) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    card.addEventListener('keydown', handleTabTrap);
    return () => {
      card.removeEventListener('keydown', handleTabTrap);
    };
  }, [activeSettingsTab.value, panelVisible]);

  if (!panelVisible) {
    return null;
  }

  return (
    <div
      className={standalone ? styles.windowShell : styles.backdrop}
      onClick={(event) => {
        if (!standalone && event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={cardRef}
        className={`${styles.card} ${standalone ? styles.windowCard : ''}`.trim()}
        role="dialog"
        aria-modal={standalone ? undefined : true}
        aria-label="Settings"
      >
        <div className={styles.header}>
          <div className={styles.title}>Settings</div>
          <div className={styles.actions}>
            <button type="button" className={styles.editConfigLink} onClick={() => { void window.quakeshell.config.openInEditor(); }}>
              Edit Config File
            </button>
            <button type="button" className={styles.closeBtn} aria-label="Close settings" onClick={handleClose}>
              ✕
            </button>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Settings tabs">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeSettingsTab.value === tab}
              className={`${styles.tab} ${activeSettingsTab.value === tab ? styles.tabActive : ''}`}
              onClick={() => {
                activeSettingsTab.value = tab;
              }}
            >
              {SETTINGS_TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className={styles.content} role="tabpanel">
          {renderSettingsContent()}
        </div>
      </div>
    </div>
  );
}