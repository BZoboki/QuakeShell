import { useEffect, useRef, useState } from 'preact/hooks';
import { APP_NAME } from '../../shared/constants';
import {
  delayPendingUpdateRestart,
  initUpdateStore,
  initUpdateOperationStore,
  isRestartPromptVisible,
  pendingUpdate,
  restartPendingUpdateNow,
} from '../state/update-store';
import styles from './UpdateRestartPrompt.module.css';

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function UpdateRestartPrompt() {
  const promptVisible = isRestartPromptVisible.value;
  const update = pendingUpdate.value;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    void initUpdateStore().catch((error: unknown) => {
      console.error('[UpdateRestartPrompt] initUpdateStore failed:', error);
    });
    void initUpdateOperationStore().catch((error: unknown) => {
      console.error('[UpdateRestartPrompt] initUpdateOperationStore failed:', error);
    });
  }, []);

  useEffect(() => {
    if (!promptVisible || !update) {
      setIsRestarting(false);
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = dialog.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    } else {
      dialog.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRestarting) {
        event.preventDefault();
        void handleLater();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, [promptVisible, update?.version, isRestarting]);

  if (!promptVisible || !update) {
    return null;
  }

  async function handleLater() {
    try {
      await delayPendingUpdateRestart();
    } catch (error) {
      console.error('[UpdateRestartPrompt] delayPendingUpdateRestart failed:', error);
    }
  }

  async function handleRestartNow() {
    setIsRestarting(true);

    try {
      const didRestart = await restartPendingUpdateNow();
      if (!didRestart) {
        setIsRestarting(false);
      }
    } catch (error) {
      setIsRestarting(false);
      console.error('[UpdateRestartPrompt] restartPendingUpdateNow failed:', error);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-restart-title"
        tabIndex={-1}
      >
        <p className={styles.eyebrow}>Update Ready</p>
        <h2 id="update-restart-title" className={styles.title}>
          Restart {APP_NAME} to apply the new build
        </h2>
        <p className={styles.body}>
          Version <span className={styles.version}>{update.version}</span> is installed and ready to apply.
          Restart now to switch over, or choose Later to keep the current terminal session intact.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              void handleLater();
            }}
            disabled={isRestarting}
          >
            Later
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => {
              void handleRestartNow();
            }}
            disabled={isRestarting}
          >
            {isRestarting ? 'Restarting…' : 'Restart now'}
          </button>
        </div>
      </div>
    </div>
  );
}