import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { IPty } from 'node-pty';
import log from 'electron-log/main';
import { CHANNELS } from '@shared/channels';
import type {
  TabSessionDTO,
  TabColor,
  Shell,
  TabCreateOptions,
  TabStatus,
} from '@shared/ipc-types';
import type { TerminalConfig } from '@shared/config-types';
import type { ConfigStore } from './config-store';
import * as terminalManager from './terminal-manager';
import * as windowManager from './window-manager';
import {
  createOscCwdScanner,
  getLastUsedDirectory,
  recordUsedDirectory,
} from './cwd-tracker';

const logger = log.scope('tab-manager');

interface TabSession {
  id: string;
  shellType: Shell;
  status: TabStatus;
  ptyProcess: IPty | null;
  color: TabColor;
  manualName?: string;
  createdAt: number;
  cwd?: string;
  cols: number;
  rows: number;
}

const tabs = new Map<string, TabSession>();
let activeTabId: string | null = null;
let mainWindow: BrowserWindow | null = null;
let configStore: ConfigStore | null = null;
let colorPaletteIndex = 0;
let hasUsedInitialWslFocusFadeGuard = false;

const INITIAL_WSL_FOCUS_FADE_SUPPRESSION_MS = 1500;

function toDTO(session: TabSession): TabSessionDTO {
  return {
    id: session.id,
    shellType: session.shellType,
    status: session.status,
    color: session.color,
    manualName: session.manualName,
    createdAt: session.createdAt,
  };
}

function getStore(): ConfigStore {
  if (!configStore) throw new Error('TabManager not initialized');
  return configStore;
}

function getNextColor(): TabColor {
  const palette = getStore().get('tabs').colorPalette;
  const color = palette[colorPaletteIndex % palette.length];
  colorPaletteIndex++;
  return color;
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function guardInitialWslFocusFade(shell: Shell): void {
  if (shell !== 'wsl' || hasUsedInitialWslFocusFadeGuard) {
    return;
  }

  windowManager.suppressFocusFadeForShellLaunch(INITIAL_WSL_FOCUS_FADE_SUPPRESSION_MS);
  hasUsedInitialWslFocusFadeGuard = true;
}

/**
 * Resolve the start directory for a tab launched without an explicit cwd,
 * based on the `terminal.startLocation` config. Returns undefined for 'home'
 * (and as fallback) so the PTY layer applies its user-profile default.
 */
function resolveStartDirectory(store: ConfigStore): string | undefined {
  const terminalConfig = store.get('terminal') as TerminalConfig | undefined;
  const startLocation = terminalConfig?.startLocation ?? 'home';
  if (startLocation === 'home') {
    return undefined;
  }

  const candidate = startLocation === 'custom'
    ? (terminalConfig?.customStartDirectory ?? '').trim()
    : (getLastUsedDirectory() ?? '');

  if (!candidate) {
    if (startLocation === 'lastUsed') {
      logger.info('No last used directory recorded yet; falling back to home');
    }
    return undefined;
  }

  if (!fs.existsSync(candidate)) {
    logger.warn(`Start directory does not exist: ${candidate}; falling back to home`);
    return undefined;
  }

  return candidate;
}

function spawnSessionPty(session: TabSession): IPty {
  let spawnedPty: IPty | null = null;
  const scanForCwdReport = createOscCwdScanner((cwd) => recordUsedDirectory(cwd));

  spawnedPty = terminalManager.spawnPty(
    session.shellType,
    session.cols,
    session.rows,
    (data: string) => {
      if (session.ptyProcess !== spawnedPty) {
        return;
      }

      scanForCwdReport(data);
      broadcast(CHANNELS.TAB_DATA, { tabId: session.id, data });
    },
    (exitCode: number, signal: number) => {
      if (session.ptyProcess !== spawnedPty) {
        return;
      }

      session.ptyProcess = null;
      session.status = 'exited';
      broadcast(CHANNELS.TAB_EXITED, { tabId: session.id, exitCode, signal });
    },
    session.cwd,
  );

  return spawnedPty;
}

export async function init(
  window: BrowserWindow,
  store: ConfigStore,
): Promise<void> {
  mainWindow = window;
  configStore = store;
  const dto = createTab({});
  logger.info('TabManager initialized with default tab', { tabId: dto.id });
}

export function createTab(options: TabCreateOptions): TabSessionDTO {
  const maxTabs = getStore().get('tabs').maxTabs;
  if (tabs.size >= maxTabs) {
    throw new Error(`Max tabs reached (${maxTabs})`);
  }

  const id = randomUUID();
  const shellType: Shell = options.shellType ?? getStore().get('defaultShell');
  const color = getNextColor();
  const createdAt = Date.now();
  const deferred = options.deferred ?? false;
  const cwd = options.cwd ?? resolveStartDirectory(getStore());
  if (options.cwd) {
    recordUsedDirectory(options.cwd);
  }

  const session: TabSession = {
    id,
    shellType,
    status: 'pending',
    ptyProcess: null,
    color,
    manualName: undefined,
    createdAt,
    cwd,
    cols: 80,
    rows: 24,
  };

  if (!deferred) {
    guardInitialWslFocusFade(shellType);
    session.ptyProcess = spawnSessionPty(session);
    session.status = 'running';
  }

  tabs.set(id, session);
  if (options.activate !== false) {
    setActiveTab(id);
  }

  return toDTO(session);
}

/** Spawn a PTY for a pending (deferred) tab */
export function spawnTab(tabId: string, shellType?: Shell): TabSessionDTO {
  const session = tabs.get(tabId);
  if (!session) throw new Error(`Tab not found: ${tabId}`);
  if (session.status !== 'pending') throw new Error(`Tab already spawned: ${tabId}`);

  const shell = shellType ?? session.shellType;
  session.shellType = shell;

  guardInitialWslFocusFade(shell);
  session.ptyProcess = spawnSessionPty(session);
  session.status = 'running';
  logger.info('Tab shell spawned', { tabId, shell });

  return toDTO(session);
}

export function closeTab(tabId: string): void {
  const session = tabs.get(tabId);
  if (!session) {
    throw new Error(`Tab not found: ${tabId}`);
  }

  const ptyProcess = session.ptyProcess;
  session.ptyProcess = null;
  if (ptyProcess) {
    terminalManager.killPty(ptyProcess);
  }
  tabs.delete(tabId);
  broadcast(CHANNELS.TAB_CLOSED, { tabId });

  if (activeTabId === tabId) {
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      setActiveTab(remaining[0]);
    } else {
      activeTabId = null;
    }
  }

  // Last tab closed — hide window and create a fresh default tab
  if (tabs.size === 0) {
    windowManager.hide().catch(() => {});
    createTab({});
  }
}

export function setActiveTab(tabId: string): void {
  activeTabId = tabId;
  broadcast(CHANNELS.TAB_ACTIVE_CHANGED, { tabId });
}

export function renameTab(tabId: string, name: string): void {
  const session = tabs.get(tabId);
  if (!session) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  session.manualName = name;
  broadcast(CHANNELS.TAB_RENAMED, { tabId, name });
}

export function reorderTabs(tabIds: string[]): TabSessionDTO[] {
  if (tabIds.length !== tabs.size) {
    throw new Error('Tab reorder payload did not match current tab count');
  }

  const seen = new Set<string>();
  const reorderedEntries: Array<[string, TabSession]> = [];

  for (const tabId of tabIds) {
    if (seen.has(tabId)) {
      throw new Error(`Duplicate tab in reorder payload: ${tabId}`);
    }

    const session = tabs.get(tabId);
    if (!session) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    seen.add(tabId);
    reorderedEntries.push([tabId, session]);
  }

  tabs.clear();
  for (const [tabId, session] of reorderedEntries) {
    tabs.set(tabId, session);
  }

  return listTabs();
}

export function listTabs(): TabSessionDTO[] {
  return [...tabs.values()].map(toDTO);
}

export function writeToTab(tabId: string, data: string): void {
  const session = tabs.get(tabId);
  if (!session) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  if (!session.ptyProcess) {
    return; // pending tab — ignore input silently
  }
  terminalManager.writeToPty(session.ptyProcess, data);
}

export function resizeTab(tabId: string, cols: number, rows: number): void {
  const session = tabs.get(tabId);
  if (!session) {
    throw new Error(`Tab not found: ${tabId}`);
  }
  if (!session.ptyProcess) {
    return; // pending tab — nothing to resize
  }
  session.cols = cols;
  session.rows = rows;
  terminalManager.resizePty(session.ptyProcess, cols, rows);
}

export function refreshEnvironment(tabId: string): void {
  const session = tabs.get(tabId);
  if (!session) {
    throw new Error(`Tab not found: ${tabId}`);
  }

  if (session.status !== 'running' || !session.ptyProcess) {
    throw new Error('Terminal environment refresh is only available for a running tab');
  }

  const command = terminalManager.getEnvironmentRefreshCommand(session.shellType);
  if (!command) {
    throw new Error('Terminal environment refresh is unavailable for this shell');
  }

  try {
    terminalManager.writeToPty(session.ptyProcess, `${command}\r`);
    logger.info('Refreshed terminal environment in place', { tabId, shell: session.shellType });
  } catch (error) {
    logger.warn('Failed to refresh terminal environment in place', { tabId, error });
    throw error;
  }
}

export function getActiveTabId(): string | null {
  return activeTabId;
}

/** Kill all tab PTY processes — for use during app shutdown. */
export function destroyAllTabs(): void {
  for (const session of tabs.values()) {
    const ptyProcess = session.ptyProcess;
    session.ptyProcess = null;
    if (ptyProcess) {
      terminalManager.killPty(ptyProcess);
    }
  }
}

/** @internal For test use only */
export function _reset(): void {
  for (const session of tabs.values()) {
    try {
      if (session.ptyProcess) terminalManager.killPty(session.ptyProcess);
    } catch {
      // ignore
    }
  }
  tabs.clear();
  activeTabId = null;
  mainWindow = null;
  configStore = null;
  colorPaletteIndex = 0;
  hasUsedInitialWslFocusFadeGuard = false;
}
