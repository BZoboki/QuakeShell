import { Notification, app, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log/main';
import { APP_NAME } from '@shared/constants';
import type {
  PendingUpdatePayload,
  UpdateOperationState,
} from '@shared/ipc-types';
import * as windowManager from './window-manager';

const logger = log.scope('notification-manager');
const updateLogger = log.scope('update-checker');

const UPDATE_FETCH_TIMEOUT = 10_000; // 10 seconds
const REGISTRY_URL = 'https://registry.npmjs.org/quakeshell/latest';
const RELEASES_URL = 'https://github.com/jatson/QuakeShell/releases';
const NPM_PACKAGE_NAME = 'quakeshell';
const WINDOWS_PLATFORM = 'win32';
const WINDOWS_ARCH = 'x64';
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

let pendingUpdateVersion: string | null = null;
let installingUpdateVersion: string | null = null;
let updateInstallPromise: Promise<void> | null = null;
let manualUpdateInstallRequested = false;
let updateCheckPromise: Promise<UpdateCheckResult> | null = null;
let manualUpdateCheckRequested = false;
let updateRestartHandler: (() => void) | null = null;
let updateOperationState: UpdateOperationState | null = null;
const pendingUpdateListeners = new Set<(payload: PendingUpdatePayload | null) => void>();
const updateOperationListeners = new Set<(state: UpdateOperationState | null) => void>();

export interface NotificationOptions {
  title: string;
  body: string;
  onClick?: () => void;
  bypassSuppression?: boolean;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  error?: string;
}

export function setUpdateRestartHandler(handler: (() => void) | null): void {
  updateRestartHandler = handler;
}

function emitUpdateOperationChanged(): void {
  for (const listener of updateOperationListeners) {
    try {
      listener(updateOperationState);
    } catch (error) {
      updateLogger.warn(`Update operation listener failed: ${getErrorMessage(error)}`);
    }
  }
}

function setUpdateOperationState(state: UpdateOperationState | null): void {
  updateOperationState = state;
  emitUpdateOperationChanged();
}

export function getUpdateOperationState(): UpdateOperationState | null {
  return updateOperationState;
}

export function onUpdateOperationChange(
  listener: (state: UpdateOperationState | null) => void,
): () => void {
  updateOperationListeners.add(listener);
  return () => {
    updateOperationListeners.delete(listener);
  };
}

function buildPendingUpdatePayload(version: string): PendingUpdatePayload {
  return {
    version,
    source: 'background-install',
  };
}

function emitPendingUpdateChanged(): void {
  const payload = getPendingUpdate();
  for (const listener of pendingUpdateListeners) {
    try {
      listener(payload);
    } catch (error) {
      updateLogger.warn(`Pending update listener failed: ${getErrorMessage(error)}`);
    }
  }
}

function setPendingUpdateVersion(version: string | null): void {
  if (pendingUpdateVersion === version) {
    return;
  }

  pendingUpdateVersion = version;
  emitPendingUpdateChanged();
}

export function getPendingUpdate(): PendingUpdatePayload | null {
  return pendingUpdateVersion ? buildPendingUpdatePayload(pendingUpdateVersion) : null;
}

export function onPendingUpdateChange(
  listener: (payload: PendingUpdatePayload | null) => void,
): () => void {
  pendingUpdateListeners.add(listener);
  return () => {
    pendingUpdateListeners.delete(listener);
  };
}

export function delayPendingUpdate(): PendingUpdatePayload | null {
  return getPendingUpdate();
}

function getInstallRoot(environment = process.env): string {
  return path.resolve(environment.QUAKESHELL_INSTALL_ROOT || path.join(os.homedir(), '.quakeshell', 'npm'));
}

function getVersionInstallDir(version: string, environment = process.env): string {
  return path.join(getInstallRoot(environment), 'versions', `${version}-${WINDOWS_PLATFORM}-${WINDOWS_ARCH}`);
}

function findExecutable(rootDirectory: string, executableName: string): string | null {
  if (!fs.existsSync(rootDirectory)) {
    return null;
  }

  const pendingDirectories = [rootDirectory];
  const targetName = executableName.toLowerCase();
  const visitedDirectories = new Set<string>();

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    let realPath: string;
    try {
      realPath = (fs.realpathSync.native || fs.realpathSync)(currentDirectory);
    } catch {
      continue;
    }

    if (visitedDirectories.has(realPath)) {
      continue;
    }

    visitedDirectories.add(realPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === targetName) {
        return fullPath;
      }
    }
  }

  return null;
}

function getInstalledExecutable(version: string, environment = process.env): string | null {
  return findExecutable(
    getVersionInstallDir(version, environment),
    `${NPM_PACKAGE_NAME}.exe`,
  );
}

function getReleasePageUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

function isNpmManagedInstall(environment = process.env, executablePath = process.execPath): boolean {
  const versionsRoot = `${path.resolve(getInstallRoot(environment), 'versions').toLowerCase()}${path.sep}`;
  const normalizedExecutablePath = path.resolve(executablePath).toLowerCase();
  return normalizedExecutablePath.startsWith(versionsRoot);
}

function canAutoInstallUpdate(environment = process.env, executablePath = process.execPath): boolean {
  return process.platform === WINDOWS_PLATFORM && isNpmManagedInstall(environment, executablePath);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSemver(version: string): [number, number, number] | null {
  if (!SEMVER_PATTERN.test(version)) {
    return null;
  }

  const [coreVersion] = version.split(/[+-]/, 1);
  const [major, minor, patch] = coreVersion.split('.', 3).map(Number);
  return [major, minor, patch];
}

function validateRegistryVersion(version: string | null): string {
  if (!version || parseSemver(version) === null) {
    throw new Error('Invalid response: invalid version field');
  }

  return version;
}

function runNpmInstall(version: string): Promise<void> {
  if (parseSemver(version) === null) {
    return Promise.reject(new Error(`Refusing to install invalid version: ${version}`));
  }

  const npmExecutable = process.platform === WINDOWS_PLATFORM ? 'npm.cmd' : 'npm';
  // shell: true is required on Windows — spawning .cmd/.bat files without a shell
  // throws `spawn EINVAL` since Node 20.12.2 (CVE-2024-27980). The version string
  // is validated against SEMVER_PATTERN above, so no shell metacharacters can
  // reach the command line.
  const child = spawn(npmExecutable, ['install', '-g', `${NPM_PACKAGE_NAME}@${version}`], {
    stdio: 'ignore',
    windowsHide: true,
    shell: true,
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm install failed with exit code ${code ?? 'unknown'} for ${NPM_PACKAGE_NAME}@${version}`));
    });
  });
}

function launchDetachedExecutable(executablePath: string): Promise<void> {
  const child = spawn(executablePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      try {
        child.unref();
      } catch {
        // Ignore unref failures after a successful spawn.
      }

      resolve();
    });
  });
}

async function openReleasePageFallback(
  currentVersion: string,
  version: string,
  reason: string,
): Promise<void> {
  setPendingUpdateVersion(null);

  try {
    await shell.openExternal(getReleasePageUrl(version));
    setUpdateOperationState({
      phase: 'available',
      currentVersion,
      latestVersion: version,
      action: 'download',
    });
  } catch (error) {
    const message = getErrorMessage(error);
    updateLogger.warn(`Failed to open fallback release page: ${message}`);
    setUpdateOperationState({
      phase: 'error',
      currentVersion,
      latestVersion: version,
      action: 'download',
      error: `${reason} Could not open the download page: ${message}`,
    });
  }
}

async function restartIntoInstalledVersion(version: string): Promise<boolean> {
  const executablePath = getInstalledExecutable(version);
  const currentVersion = getUpdateOperationState()?.currentVersion ?? app.getVersion();

  if (!executablePath) {
    const reason = `Installed executable for ${APP_NAME} v${version} was not found.`;
    updateLogger.warn(reason);
    await openReleasePageFallback(currentVersion, version, reason);
    return false;
  }

  try {
    await launchDetachedExecutable(executablePath);
    setPendingUpdateVersion(null);
    setUpdateOperationState(null);
    if (updateRestartHandler) {
      updateRestartHandler();
    } else {
      app.quit();
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    const reason = `Failed to relaunch ${APP_NAME} v${version}: ${message}`;
    updateLogger.warn(reason);
    await openReleasePageFallback(currentVersion, version, reason);
    return false;
  }
}

export async function restartPendingUpdate(): Promise<boolean> {
  const pendingUpdate = getPendingUpdate();
  if (!pendingUpdate) {
    return false;
  }

  return restartIntoInstalledVersion(pendingUpdate.version);
}

async function installAvailableUpdate(
  currentVersion: string,
  latestVersion: string,
  manual = false,
): Promise<void> {
  const validatedVersion = validateRegistryVersion(latestVersion);

  if (getPendingUpdate()?.version === validatedVersion) {
    setUpdateOperationState({
      phase: 'ready-to-restart',
      currentVersion,
      latestVersion: validatedVersion,
      action: 'restart',
    });
    return;
  }

  if (updateInstallPromise) {
    manualUpdateInstallRequested ||= manual;
    if (installingUpdateVersion && installingUpdateVersion !== validatedVersion) {
      updateLogger.info(
        `Update install already running for ${installingUpdateVersion}; deferring ${validatedVersion}`,
      );
    }

    return updateInstallPromise;
  }

  installingUpdateVersion = validatedVersion;
  manualUpdateInstallRequested = manual;
  setUpdateOperationState({
    phase: 'installing',
    currentVersion,
    latestVersion: validatedVersion,
    action: null,
  });
  updateInstallPromise = runNpmInstall(validatedVersion)
    .then(() => {
      setUpdateOperationState({
        phase: 'ready-to-restart',
        currentVersion,
        latestVersion: validatedVersion,
        action: 'restart',
      });
      setPendingUpdateVersion(validatedVersion);
      updateLogger.info(`Update installed: ${validatedVersion}`);
    })
    .catch((error) => {
      if (pendingUpdateVersion === validatedVersion) {
        setPendingUpdateVersion(null);
      }
      const message = getErrorMessage(error);
      updateLogger.warn(`Update install failed: ${message}`);
      if (manualUpdateInstallRequested) {
        setUpdateOperationState({
          phase: 'error',
          currentVersion,
          latestVersion: validatedVersion,
          action: 'install',
          error: message,
        });
        send({
          title: APP_NAME,
          body: `Update installation failed. Click to retry ${APP_NAME} v${validatedVersion}.`,
          onClick: () => {
            void windowManager.openSettingsWindow('updates').catch((openError) => {
              updateLogger.warn(`Failed to open Updates settings: ${getErrorMessage(openError)}`);
            });
          },
          bypassSuppression: true,
        });
      } else {
        setUpdateOperationState(null);
      }
    })
    .finally(() => {
      installingUpdateVersion = null;
      updateInstallPromise = null;
      manualUpdateInstallRequested = false;
    });

  return updateInstallPromise;
}

export async function startAvailableUpdate(): Promise<UpdateOperationState | null> {
  const state = getUpdateOperationState();
  if (
    (state?.phase !== 'available' && state?.phase !== 'error')
    || state.action !== 'install'
    || !state.latestVersion
  ) {
    return state;
  }

  await installAvailableUpdate(state.currentVersion, state.latestVersion, true);
  return getUpdateOperationState();
}

export async function openAvailableUpdateDownload(): Promise<boolean> {
  const state = getUpdateOperationState();
  if (
    (state?.phase !== 'available' && state?.phase !== 'error')
    || state.action !== 'download'
    || !state.latestVersion
  ) {
    return false;
  }

  try {
    await shell.openExternal(getReleasePageUrl(state.latestVersion));
    if (state.phase === 'error') {
      setUpdateOperationState({
        phase: 'available',
        currentVersion: state.currentVersion,
        latestVersion: state.latestVersion,
        action: 'download',
      });
    }
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    updateLogger.warn(`Failed to open update download page: ${message}`);
    setUpdateOperationState({
      phase: 'error',
      currentVersion: state.currentVersion,
      latestVersion: state.latestVersion,
      action: 'download',
      error: message,
    });
    return false;
  }
}

/**
 * Returns true if the terminal is visible and focused — notifications should be suppressed.
 */
export function isNotificationSuppressed(): boolean {
  if (!windowManager.isVisible()) return false;
  const win = windowManager.getWindow();
  return win !== null && !win.isDestroyed() && win.isFocused();
}

/**
 * Send a Windows toast notification.
 * Suppressed if the terminal is visible and focused (AC #3).
 */
export function send(options: NotificationOptions): void {
  if (!options.bypassSuppression && isNotificationSuppressed()) {
    logger.info('Notification suppressed — terminal is visible and focused');
    return;
  }

  try {
    const notification = new Notification({
      title: options.title,
      body: options.body,
    });

    notification.on('click', () => {
      if (options.onClick) {
        options.onClick();
      } else {
        windowManager.toggle();
      }
    });

    notification.show();
    logger.info(`Notification sent: ${options.title} — ${options.body}`);
  } catch (error) {
    logger.error('Failed to send notification:', error);
  }
}

/**
 * Compare two semver strings (major.minor.patch).
 * Returns true if b is newer than a.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) {
    return false;
  }

  for (let i = 0; i < 3; i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

/**
 * Check npm registry for a newer version of QuakeShell.
 * @param manual - true when triggered by user; false for periodic background checks
 */
export function checkForUpdates(manual = false): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const pendingUpdate = getPendingUpdate();

  if (pendingUpdate) {
    setUpdateOperationState({
      phase: 'ready-to-restart',
      currentVersion,
      latestVersion: pendingUpdate.version,
      action: 'restart',
    });
    return Promise.resolve({
      updateAvailable: true,
      currentVersion,
      latestVersion: pendingUpdate.version,
    });
  }

  if (updateInstallPromise && installingUpdateVersion) {
    manualUpdateInstallRequested ||= manual;
    return Promise.resolve({
      updateAvailable: true,
      currentVersion,
      latestVersion: installingUpdateVersion,
    });
  }

  if (updateCheckPromise) {
    if (manual && !manualUpdateCheckRequested) {
      manualUpdateCheckRequested = true;
      setUpdateOperationState({
        phase: 'checking',
        currentVersion: app.getVersion(),
        latestVersion: null,
        action: null,
      });
    }

    return updateCheckPromise;
  }

  manualUpdateCheckRequested = manual;

  if (manual) {
    setUpdateOperationState({
      phase: 'checking',
      currentVersion,
      latestVersion: null,
      action: null,
    });
  }

  updateCheckPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT);
      let response: Response;

      try {
        response = await fetch(REGISTRY_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { version?: string };
      const latestVersion = validateRegistryVersion(data.version ?? null);

      const completedPendingUpdate = getPendingUpdate();
      if (completedPendingUpdate) {
        setUpdateOperationState({
          phase: 'ready-to-restart',
          currentVersion,
          latestVersion: completedPendingUpdate.version,
          action: 'restart',
        });
        return {
          updateAvailable: true,
          currentVersion,
          latestVersion: completedPendingUpdate.version,
        };
      }

      const updateAvailable = isNewerVersion(currentVersion, latestVersion);
      const shouldShowManualResult = manualUpdateCheckRequested;
      const existingOperationState = getUpdateOperationState();
      const hasManuallyDeferredInstall = existingOperationState?.phase === 'available'
        && existingOperationState.action === 'install';

      if (updateAvailable) {
        if (getPendingUpdate()?.version === latestVersion) {
          setUpdateOperationState({
            phase: 'ready-to-restart',
            currentVersion,
            latestVersion,
            action: 'restart',
          });
          updateLogger.info(`Update already installed and waiting for restart: ${latestVersion}`);
        } else if (shouldShowManualResult || hasManuallyDeferredInstall) {
          setUpdateOperationState({
            phase: 'available',
            currentVersion,
            latestVersion,
            action: canAutoInstallUpdate() ? 'install' : 'download',
          });
        } else if (canAutoInstallUpdate()) {
          void installAvailableUpdate(currentVersion, latestVersion);
        } else {
          setUpdateOperationState({
            phase: 'available',
            currentVersion,
            latestVersion,
            action: 'download',
          });
          send({
            title: APP_NAME,
            body: `${APP_NAME} v${latestVersion} available. Click to download.`,
            onClick: () => {
              void shell.openExternal(getReleasePageUrl(latestVersion));
            },
            bypassSuppression: true,
          });
        }
        updateLogger.info(`Update available: ${currentVersion} → ${latestVersion}`);
      } else if (shouldShowManualResult || existingOperationState !== null) {
        setUpdateOperationState({
          phase: 'up-to-date',
          currentVersion,
          latestVersion,
          action: null,
        });
        if (shouldShowManualResult) {
          send({
            title: APP_NAME,
            body: `${APP_NAME} is up to date`,
            bypassSuppression: true,
          });
        }
        updateLogger.info(`Up to date: ${currentVersion}`);
      } else {
        updateLogger.verbose(`No update: ${currentVersion} is current`);
      }

      return { updateAvailable, currentVersion, latestVersion };
    } catch (error) {
      const message = getErrorMessage(error);
      updateLogger.verbose(`Update check failed: ${message}`);
      const completedPendingUpdate = getPendingUpdate();
      if (completedPendingUpdate) {
        setUpdateOperationState({
          phase: 'ready-to-restart',
          currentVersion,
          latestVersion: completedPendingUpdate.version,
          action: 'restart',
        });
        return {
          updateAvailable: true,
          currentVersion,
          latestVersion: completedPendingUpdate.version,
        };
      }

      if (manualUpdateCheckRequested) {
        setUpdateOperationState({
          phase: 'error',
          currentVersion,
          latestVersion: null,
          action: null,
          error: message,
        });
        send({
          title: APP_NAME,
          body: 'Update check failed. Click to try again.',
          onClick: () => {
            void checkForUpdates(true);
          },
          bypassSuppression: true,
        });
      }
      return { updateAvailable: false, currentVersion, latestVersion: null, error: message };
    }
  })();

  void updateCheckPromise.finally(() => {
    updateCheckPromise = null;
    manualUpdateCheckRequested = false;
  });

  return updateCheckPromise;
}

export function _reset(): void {
  pendingUpdateVersion = null;
  installingUpdateVersion = null;
  updateInstallPromise = null;
  manualUpdateInstallRequested = false;
  updateCheckPromise = null;
  manualUpdateCheckRequested = false;
  updateRestartHandler = null;
  updateOperationState = null;
  pendingUpdateListeners.clear();
  updateOperationListeners.clear();
}
