import { useEffect, useState } from 'preact/hooks';
import type { UpdateOperationState } from '@shared/ipc-types';
import {
  applyUpdateOperationState,
  initUpdateOperationStore,
  installedVersion,
  restartPendingUpdateNow,
  updateOperation,
} from '../../state/update-store';
import SettingsRow from './SettingsRow';
import styles from './UpdateSettings.module.css';

function getStatusText(state: UpdateOperationState | null): string {
  if (!state) {
    return 'No update check has been run.';
  }

  switch (state.phase) {
    case 'checking':
      return 'Checking for updates.';
    case 'available':
      return state.action === 'download'
        ? `Version ${state.latestVersion} is available to download.`
        : `Version ${state.latestVersion} is available to install.`;
    case 'installing':
      return `Installing version ${state.latestVersion}.`;
    case 'ready-to-restart':
      return `Version ${state.latestVersion} is ready to restart.`;
    case 'up-to-date':
      return 'QuakeShell is up to date.';
    case 'error':
      if (state.action === 'install') {
        return 'Update installation failed.';
      }
      if (state.action === 'download') {
        return 'Opening the update download failed.';
      }
      if (state.action === 'restart') {
        return 'Restarting QuakeShell failed.';
      }
      return 'Update check failed.';
  }
}

export default function UpdateSettings() {
  const version = installedVersion.value;
  const state = updateOperation.value;
  const [isActing, setIsActing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void initUpdateOperationStore().catch((error: unknown) => {
      if (!cancelled) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load update status');
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const retryInitialLoad = async () => {
    setIsActing(true);
    setLoadError('');

    try {
      await initUpdateOperationStore();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Update action failed');
    } finally {
      setIsActing(false);
    }
  };

  const runAction = async (action: () => Promise<boolean>, failureMessage: string) => {
    setIsActing(true);
    setActionError('');

    try {
      if (!await action()) {
        setActionError(failureMessage);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : failureMessage);
    } finally {
      setIsActing(false);
    }
  };

  const runOperationAction = async (
    action: () => Promise<UpdateOperationState | null>,
  ) => {
    setIsActing(true);
    setActionError('');

    try {
      applyUpdateOperationState(await action());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Update action failed');
    } finally {
      setIsActing(false);
    }
  };

  const renderAction = () => {
    if (loadError) {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void retryInitialLoad(); }}
        >
          Retry Loading Updates
        </button>
      );
    }

    if (version === null) {
      return <button type="button" className={styles.actionButton} disabled>Loading...</button>;
    }

    if (state?.phase === 'checking') {
      return <button type="button" className={styles.actionButton} disabled>Checking...</button>;
    }

    if (state?.phase === 'installing') {
      return <button type="button" className={styles.actionButton} disabled>Installing...</button>;
    }

    if (state?.phase === 'available' && state.action === 'install') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runOperationAction(() => window.quakeshell.app.startAvailableUpdate()); }}
        >
          Install Update
        </button>
      );
    }

    if (state?.phase === 'error' && state.action === 'install') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runOperationAction(() => window.quakeshell.app.startAvailableUpdate()); }}
        >
          Retry Install Update
        </button>
      );
    }

    if (state?.phase === 'available' && state.action === 'download') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runAction(() => window.quakeshell.app.openAvailableUpdateDownload(), 'Unable to open the download page. Try again.'); }}
        >
          Download Update
        </button>
      );
    }

    if (state?.phase === 'error' && state.action === 'download') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runAction(() => window.quakeshell.app.openAvailableUpdateDownload(), 'Unable to open the download page. Try again.'); }}
        >
          Retry Download Update
        </button>
      );
    }

    if (state?.phase === 'ready-to-restart' && state.action === 'restart') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runAction(restartPendingUpdateNow, 'Unable to restart QuakeShell. Try again.'); }}
        >
          Restart now
        </button>
      );
    }

    if (state?.phase === 'error' && state.action === 'restart') {
      return (
        <button
          type="button"
          className={styles.actionButton}
          disabled={isActing}
          onClick={() => { void runAction(restartPendingUpdateNow, 'Unable to restart QuakeShell. Try again.'); }}
        >
          Retry Restart
        </button>
      );
    }

    return (
      <button
        type="button"
        className={styles.actionButton}
        disabled={isActing}
        onClick={() => { void runOperationAction(() => window.quakeshell.app.checkForUpdates()); }}
      >
        Check for Updates
      </button>
    );
  };

  return (
    <div>
      <SettingsRow
        label="Installed Version"
        description="The QuakeShell version currently running on this computer."
      >
        <span className={styles.version}>{version ?? 'Loading...'}</span>
      </SettingsRow>

      <SettingsRow
        label="Updates"
        description="Check for updates, install supported npm releases, or open a validated download page."
      >
        <div className={styles.statusControl}>
          <div className={styles.status} aria-live="polite">{getStatusText(state)}</div>
          {renderAction()}
          {state?.phase === 'error' && state.error ? <div className={styles.error} role="alert">{state.error}</div> : null}
          {loadError ? <div className={styles.error} role="alert">{loadError}</div> : null}
          {actionError ? <div className={styles.error} role="alert">{actionError}</div> : null}
        </div>
      </SettingsRow>
    </div>
  );
}