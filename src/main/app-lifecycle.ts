import { app } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import log from 'electron-log/main';
import { type ConfigStore } from './config-store';
import * as windowManager from './window-manager';
import * as terminalManager from './terminal-manager';
import * as tabManager from './tab-manager';
import { destroyTray } from './tray-manager';
import { checkForUpdates } from './notification-manager';
import { register as registerContextMenu, deregister as deregisterContextMenu } from './context-menu-installer';

const logger = log.scope('app-lifecycle');

const UPDATE_CHECK_INTERVAL = 86_400_000; // 24 hours
const UPDATE_CHECK_INITIAL_DELAY = 300_000; // 5 minutes
const SQUIRREL_INSTALL = '--squirrel-install';
const SQUIRREL_UPDATED = '--squirrel-updated';
const SQUIRREL_UNINSTALL = '--squirrel-uninstall';

let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
let updateCheckInitialTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCwdLaunches: string[] = [];
let pendingWindowReveal = false;

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) <= 31) {
      return true;
    }
  }

  return false;
}

export function parseCwdArg(argv: string[]): string | null {
  const cwdArgIndex = argv.indexOf('--cwd');
  if (cwdArgIndex === -1 || cwdArgIndex + 1 >= argv.length) {
    return null;
  }

  return argv[cwdArgIndex + 1];
}

export function resolveCwd(rawPath: string | null): string {
  const fallbackPath = os.homedir();
  if (!rawPath) {
    return fallbackPath;
  }

  if (containsControlCharacters(rawPath)) {
    logger.warn('--cwd contained illegal characters; falling back to home dir');
    return fallbackPath;
  }

  const resolvedPath = path.resolve(rawPath);
  if (!fs.existsSync(resolvedPath)) {
    logger.warn(`--cwd path does not exist: ${resolvedPath}; falling back to home dir`);
    return fallbackPath;
  }

  return resolvedPath;
}

function showAndFocusWindow(): void {
  void windowManager.show();

  const win = windowManager.getWindow();
  if (win && !win.isDestroyed()) {
    win.focus();
  }
}

function requestWindowReveal(): void {
  const win = windowManager.getWindow();
  if (!win || win.isDestroyed()) {
    pendingWindowReveal = true;
  }

  showAndFocusWindow();
}

function queueOrCreateCwdTab(rawPath: string | null): boolean {
  if (rawPath === null) {
    return false;
  }

  const cwd = resolveCwd(rawPath);

  try {
    tabManager.createTab({ cwd });
  } catch (error) {
    if (error instanceof Error && error.message === 'TabManager not initialized') {
      pendingCwdLaunches.push(cwd);
      logger.info('Queued --cwd launch until TabManager is initialized', { cwd });
    } else {
      throw error;
    }
  }

  return true;
}

export function handleStartupCwd(argv: string[] = process.argv): boolean {
  const rawPath = parseCwdArg(argv);
  if (rawPath === null) {
    return false;
  }

  try {
    queueOrCreateCwdTab(rawPath);
  } catch (error) {
    logger.error('Failed to handle startup --cwd argument', error);
  }

  requestWindowReveal();
  return true;
}

export function flushPendingCwdLaunches(): boolean {
  const hadPendingWindowReveal = pendingWindowReveal;
  const queuedPaths = [...pendingCwdLaunches];
  pendingCwdLaunches = [];

  for (const cwd of queuedPaths) {
    try {
      tabManager.createTab({ cwd });
    } catch (error) {
      logger.error('Failed to handle queued --cwd launch', error);
    }
  }

  if (hadPendingWindowReveal || queuedPaths.length > 0) {
    showAndFocusWindow();
  }

  pendingWindowReveal = false;
  return hadPendingWindowReveal || queuedPaths.length > 0;
}

export function handleSquirrelLifecycle(argv: string[] = process.argv): boolean {
  const squirrelFlag = argv.find((arg) => arg.startsWith('--squirrel-'));
  if (!squirrelFlag) {
    return false;
  }

  logger.info(`Handling Squirrel lifecycle event: ${squirrelFlag}`);

  switch (squirrelFlag) {
    case SQUIRREL_INSTALL:
      try {
        registerContextMenu(process.execPath);
        logger.info('Context menu registered on install');
      } catch (error) {
        logger.error('Context menu registration failed during install (non-fatal)', error);
      }
      app.quit();
      return true;
    case SQUIRREL_UPDATED:
      try {
        registerContextMenu(process.execPath);
        logger.info('Context menu registered on update');
      } catch (error) {
        logger.error('Context menu registration failed during update (non-fatal)', error);
      }
      app.quit();
      return true;
    case SQUIRREL_UNINSTALL:
      try {
        deregisterContextMenu();
        logger.info('Context menu deregistered on uninstall');
      } catch (error) {
        logger.error('Context menu deregistration failed during uninstall (non-fatal)', error);
      }
      app.quit();
      return true;
    default:
      app.quit();
      return true;
  }
}

/**
 * Initialize app lifecycle: single instance lock, autostart, and startup orchestration.
 *
 * Must be called BEFORE app.whenReady() — the single instance lock is synchronous
 * and must be acquired before the event loop processes events.
 *
 * @returns false if a second instance was detected and the app should quit
 */
export function initAppLifecycle(): boolean {
  const startTime = performance.now();
  logger.info('Initializing app lifecycle');

  // 1. Acquire single instance lock — must be first
  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    logger.info('Another instance is running — quitting');
    app.quit();
    return false;
  }

  const lockTime = performance.now();
  logger.info(`Single instance lock acquired (${(lockTime - startTime).toFixed(1)}ms)`);

  // 2. Register second-instance handler — bring terminal into view
  app.on('second-instance', (_event, commandLine: string[]) => {
    logger.info('Second instance detected — revealing terminal window');
    requestWindowReveal();

    const rawPath = parseCwdArg(commandLine);
    if (rawPath !== null) {
      try {
        queueOrCreateCwdTab(rawPath);
      } catch (error) {
        logger.error('Failed to handle forwarded --cwd argument', error);
      }
    }
  });

  return true;
}

/**
 * Apply autostart settings based on config value.
 * Call after config store is available.
 */
export function applyAutostart(enabled: boolean): void {
  if (!app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: false, args: [] });
    logger.info('Autostart is disabled for the unpackaged Electron runtime');
    return;
  }

  app.setLoginItemSettings({ openAtLogin: enabled, args: [] });
  logger.info(`Autostart ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Register a config change listener for the autostart key.
 */
export function registerAutostartConfigHandler(configStore: ConfigStore): void {
  configStore.onDidChange((key, value) => {
    if (key === 'autostart') {
      applyAutostart(value as boolean);
    }
  });
}

/**
 * Log a startup timing milestone.
 */
export function logMilestone(label: string, startTime: number): void {
  const elapsed = performance.now() - startTime;
  logger.info(`[startup] ${label} (${elapsed.toFixed(1)}ms)`);
}

/**
 * Start the periodic update check timer.
 * First check runs after a 5-minute delay; subsequent checks every 24 hours.
 */
export function startPeriodicUpdateCheck(): void {
  updateCheckInitialTimer = setTimeout(() => {
    checkForUpdates(false);
    updateCheckTimer = setInterval(() => {
      checkForUpdates(false);
    }, UPDATE_CHECK_INTERVAL);
  }, UPDATE_CHECK_INITIAL_DELAY);
  logger.info('Periodic update check scheduled (5min initial, 24h interval)');
}

/** Force-kill timeout for PTY process cleanup (ms) */
const SHUTDOWN_TIMEOUT = 2000;

/**
 * Graceful shutdown: kill PTY, close window, destroy tray, quit.
 */
export function gracefulShutdown(): void {
  logger.info('Graceful shutdown initiated');

  // 0. Clear update check timers
  if (updateCheckInitialTimer) {
    clearTimeout(updateCheckInitialTimer);
    updateCheckInitialTimer = null;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }

  // 1. Kill PTY process(es) — destroy all tab PTYs first, then legacy PTY
  try {
    tabManager.destroyAllTabs();
  } catch (error) {
    logger.error('Failed to terminate tab PTYs:', error);
  }
  try {
    terminalManager.destroy();
  } catch (error) {
    logger.error('Failed to terminate legacy PTY:', error);
  }
  logger.info('PTY process(es) terminated');

  // 2. Set quitting flag so window close interceptor allows it
  windowManager.setQuitting(true);

  // 3. Close the window
  const win = windowManager.getWindow();
  if (win && !win.isDestroyed()) {
    win.close();
    logger.info('Window closed');
  }

  // 4. Destroy tray icon
  destroyTray();
  logger.info('Tray destroyed');

  // 5. Quit the app (with force-quit timeout safeguard)
  const forceQuitTimer = setTimeout(() => {
    logger.warn('Force-quitting after timeout');
    app.exit(0);
  }, SHUTDOWN_TIMEOUT);

  // Clear timeout if quit completes normally
  app.once('will-quit', () => {
    clearTimeout(forceQuitTimer);
  });

  app.quit();
  logger.info('app.quit() called');
}
