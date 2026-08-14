/** IPC type definitions and window.quakeshell type declaration */

import type { ITheme } from '@xterm/xterm';
import type { Config } from './config-schema';

export interface ThemeDefinition {
  id: string;
  name: string;
  xtermTheme: ITheme;
  chromeTokens: {
    bgTerminal: string;
    bgChrome: string;
    fgPrimary: string;
    fgDimmed: string;
    accent: string;
    border: string;
  };
}

export interface ThemeInfo extends ThemeDefinition {
  source: 'bundled' | 'community';
  swatchColors: string[];
  chromeAccent?: string;
}

export interface ConfigChangedPayload {
  key: string;
  value: unknown;
  oldValue: unknown;
}

export interface QuakeShellConfigAPI {
  getAll(): Promise<Config>;
  get<K extends keyof Config>(key: K): Promise<Config[K]>;
  get(key: string): Promise<unknown>;
  set<K extends keyof Config>(key: K, value: Config[K]): Promise<Config[K]>;
  set(key: string, value: unknown): Promise<unknown>;
  openInEditor(): Promise<void>;
  onConfigChange(callback: (payload: ConfigChangedPayload) => void): () => void;
}

export interface QuakeShellThemeAPI {
  list(): Promise<ThemeInfo[]>;
  getActive(): Promise<ThemeDefinition>;
  getCurrent(): Promise<string>;
  set(id: string): Promise<ThemeDefinition>;
  onChanged(callback: (theme: ThemeDefinition) => void): () => void;
}

export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
}

export interface AcrylicBlurResult {
  success: boolean;
  error?: string;
}

export interface HotkeyReregisterResult {
  success: boolean;
  error?: string;
}

export interface ContextMenuResult {
  success: boolean;
  error?: string;
}

export interface ContextMenuStatus {
  isRegistered: boolean;
  available?: boolean;
  error?: string;
}

export interface PendingUpdatePayload {
  version: string;
  source: 'background-install';
}

export type UpdateOperationPhase =
  | 'checking'
  | 'available'
  | 'installing'
  | 'ready-to-restart'
  | 'up-to-date'
  | 'error';

export type UpdateOperationAction = 'install' | 'download' | 'restart' | null;

export interface UpdateOperationState {
  phase: UpdateOperationPhase;
  currentVersion: string;
  latestVersion: string | null;
  action: UpdateOperationAction;
  error?: string;
}

export interface QuakeShellTerminalAPI {
  spawn(cols: number, rows: number): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  onProcessExit(callback: (payload: TerminalProcessExitPayload) => void): () => void;
  respawnShell(): Promise<void>;
  onFocus(callback: () => void): () => void;
}

export interface TabDataPayload {
  tabId: string;
  data: string;
}

export interface TabInputPayload {
  tabId: string;
  data: string;
}

export interface TabExitedPayload {
  tabId: string;
  exitCode: number;
  signal: number;
}

export interface TabAutoNamePayload {
  tabId: string;
  name: string;
}

export type TabColor = string; // hex color from palette, e.g. '#7aa2f7'

export type Shell = 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'wsl' | string;

export type TabStatus = 'pending' | 'running' | 'exited';

/** Serializable tab session — safe to send over IPC (no IPty reference) */
export interface TabSessionDTO {
  id: string;
  shellType: Shell;
  status: TabStatus;
  color: TabColor;
  manualName?: string;
  createdAt: number; // Date.now() timestamp for ordering
}

export interface TabCreateOptions {
  shellType?: Shell;
  cwd?: string;
  deferred?: boolean;
  activate?: boolean;
}

export interface AvailableShellInfo {
  id: string;
  label: string;
  icon: string;
}

export interface TabClosedPayload {
  tabId: string;
}

export interface TabActiveChangedPayload {
  tabId: string;
}

export interface TabRenamedPayload {
  tabId: string;
  name: string;
}

export interface TabCreateSplitPayload {
  primaryTabId: string;
  cwd?: string;
}

export interface TabCreateSplitResponse {
  splitTabId: string;
}

export interface TabReorderPayload {
  tabIds: string[];
}

export interface QuakeShellTabAPI {
  create(options?: TabCreateOptions): Promise<TabSessionDTO>;
  createSplit(primaryTabId: string, cwd?: string): Promise<TabCreateSplitResponse>;
  spawnTab(tabId: string, shellType: string): Promise<TabSessionDTO>;
  availableShells(): Promise<AvailableShellInfo[]>;
  close(tabId: string): Promise<void>;
  switchTo(tabId: string): Promise<void>;
  rename(tabId: string, name: string): Promise<void>;
  reorder(tabIds: string[]): Promise<TabSessionDTO[]>;
  list(): Promise<TabSessionDTO[]>;
  input(tabId: string, data: string): Promise<void>;
  resize(tabId: string, cols: number, rows: number): Promise<void>;
  onData(callback: (payload: TabDataPayload) => void): () => void;
  onClosed(callback: (payload: TabClosedPayload) => void): () => void;
  onActiveChanged(callback: (payload: TabActiveChangedPayload) => void): () => void;
  onExited(callback: (payload: TabExitedPayload) => void): () => void;
  onRenamed(callback: (payload: TabRenamedPayload) => void): () => void;
  onAutoName(callback: (payload: TabAutoNamePayload) => void): () => void;
}

export interface WindowStatePayload {
  visible: boolean;
}

export interface TerminalProcessExitPayload {
  exitCode: number;
  signal: number;
  isNormalExit: boolean;
}

export interface QuakeShellWindowAPI {
  toggle(): Promise<void>;
  openSettings(tab?: string): Promise<void>;
  closeSettings(): Promise<void>;
  resizeStart(): Promise<void>;
  resizeEnd(persist: boolean): Promise<void>;
  resetHeight(): Promise<void>;
  onStateChanged(callback: (payload: WindowStatePayload) => void): () => void;
  setReducedMotion(value: boolean): Promise<void>;
  setAcrylicBlur(enabled: boolean): Promise<AcrylicBlurResult>;
}

export interface QuakeShellAppAPI {
  checkWSL(): Promise<boolean>;
  getVersion(): Promise<string>;
  getUpdateOperation(): Promise<UpdateOperationState | null>;
  checkForUpdates(): Promise<UpdateOperationState | null>;
  startAvailableUpdate(): Promise<UpdateOperationState | null>;
  openAvailableUpdateDownload(): Promise<boolean>;
  onUpdateOperationChanged(callback: (state: UpdateOperationState | null) => void): () => void;
  getPendingUpdate(): Promise<PendingUpdatePayload | null>;
  restartPendingUpdate(): Promise<boolean>;
  delayPendingUpdate(): Promise<PendingUpdatePayload | null>;
  onUpdateReady(callback: (payload: PendingUpdatePayload | null) => void): () => void;
  registerContextMenu(): Promise<ContextMenuResult>;
  deregisterContextMenu(): Promise<ContextMenuResult>;
  getContextMenuStatus(): Promise<ContextMenuStatus>;
}

export interface TerminalPtyInfo {
  backend: 'conpty';
  buildNumber: number;
}

export interface QuakeShellPlatformAPI {
  isAcrylicSupported(): Promise<boolean>;
  getTerminalPtyInfo(): Promise<TerminalPtyInfo | null>;
}

export interface QuakeShellDisplayAPI {
  getAll(): Promise<DisplayInfo[]>;
}

export interface QuakeShellHotkeyAPI {
  reregister(newHotkey: string): Promise<HotkeyReregisterResult>;
}

export interface QuakeShellAPI {
  config: QuakeShellConfigAPI;
  theme: QuakeShellThemeAPI;
  terminal: QuakeShellTerminalAPI;
  tab: QuakeShellTabAPI;
  window: QuakeShellWindowAPI;
  app: QuakeShellAppAPI;
  platform: QuakeShellPlatformAPI;
  display: QuakeShellDisplayAPI;
  hotkey: QuakeShellHotkeyAPI;
}

declare global {
  interface Window {
    quakeshell: QuakeShellAPI;
  }
}
