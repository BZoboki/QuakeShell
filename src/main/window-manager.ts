import { BrowserWindow, screen, app, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { type ConfigStore } from './config-store';
import { CHANNELS } from '@shared/channels';
import type { MonitorTarget, WindowConfig } from '@shared/config-types';
import type { AcrylicBlurResult } from '@shared/ipc-types';

const logger = log.scope('window-manager');

// Easing functions
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => Math.pow(t, 3);

let win: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let visible = false;
let animating = false;
let isQuitting = false;
let configStoreRef: ConfigStore | null = null;
let focusFadeTimer: ReturnType<typeof setTimeout> | null = null;
let blurHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let lastDisplayId: number | null = null;
let reducedMotion = false;
let focusFadeShellLaunchSuppressedUntil = 0;

const SETTINGS_WINDOW_WIDTH = 920;
const SETTINGS_WINDOW_HEIGHT = 760;
const FOCUS_FADE_GRACE_PERIOD_MS = 300;

type StateChangeCallback = (visible: boolean) => void;
let onStateChangeCallback: StateChangeCallback | null = null;

export function onStateChange(callback: StateChangeCallback): void {
  onStateChangeCallback = callback;
}

function getActiveDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function clampHeightPercent(value: number): number {
  return Math.max(10, Math.min(90, Math.round(value)));
}

function clampWidthPercent(value: number): number {
  return Math.max(20, Math.min(100, Math.round(value)));
}

function isWindowUnavailable(window: BrowserWindow | null): boolean {
  if (!window) {
    return true;
  }

  return typeof window.isDestroyed === 'function' ? window.isDestroyed() : false;
}

function isFocusFadeSuppressed(): boolean {
  return !isWindowUnavailable(settingsWindow);
}

function getFocusFadeShellLaunchSuppressionRemaining(): number {
  return Math.max(0, focusFadeShellLaunchSuppressedUntil - Date.now());
}

function isWindowFocused(): boolean {
  const currentWindow = win;
  if (currentWindow === null) {
    return false;
  }

  if (typeof currentWindow.isDestroyed === 'function' && currentWindow.isDestroyed()) {
    return false;
  }

  if (typeof currentWindow.isFocused !== 'function') {
    return false;
  }

  return currentWindow.isFocused();
}

export function suppressFocusFadeForShellLaunch(durationMs = 1200): void {
  const normalizedDuration = Math.max(0, Math.round(durationMs));
  if (normalizedDuration === 0) {
    return;
  }

  focusFadeShellLaunchSuppressedUntil = Math.max(
    focusFadeShellLaunchSuppressedUntil,
    Date.now() + normalizedDuration,
  );

  logger.info(`Focus-fade suppressed for shell launch (${normalizedDuration}ms)`);
}

function getPackagedRendererEntryCandidates(): string[] {
  const rendererName = typeof MAIN_WINDOW_VITE_NAME === 'string'
    ? MAIN_WINDOW_VITE_NAME.trim()
    : '';

  if (!rendererName) {
    throw new Error('MAIN_WINDOW_VITE_NAME is not defined. Renderer assets cannot be resolved.');
  }

  return [
    path.join(__dirname, `../renderer/${rendererName}/index.html`),
    path.join(__dirname, `../../src/renderer/.vite/renderer/${rendererName}/index.html`),
  ];
}

export function resolveRendererEntryPath(
  pathExists: (candidatePath: string) => boolean = fs.existsSync,
): string {
  const candidates = getPackagedRendererEntryCandidates();
  const matchedPaths = candidates.filter((candidatePath) => pathExists(candidatePath));

  if (matchedPaths.length > 0) {
    if (matchedPaths.length > 1) {
      logger.warn(`Multiple packaged renderer entries found. Preferring ${matchedPaths[0]}.`);
    }

    if (app.isPackaged && matchedPaths[0] !== candidates[0]) {
      logger.info(`Loading packaged renderer from ${matchedPaths[0]}`);
    }

    return matchedPaths[0];
  }

  throw new Error(`No renderer entry HTML found. Tried: ${candidates.join(', ')}`);
}

function loadRendererWindow(targetWindow: BrowserWindow, query?: Record<string, string>): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);

    for (const [key, value] of Object.entries(query ?? {})) {
      rendererUrl.searchParams.set(key, value);
    }

    return targetWindow.loadURL(rendererUrl.toString());
  }

  const rendererPath = resolveRendererEntryPath();

  if (query && Object.keys(query).length > 0) {
    return targetWindow.loadFile(rendererPath, { query });
  }

  return targetWindow.loadFile(rendererPath);
}

function getConfiguredWindowSettings(): WindowConfig {
  const legacyHeight = configStoreRef?.get('dropHeight') ?? 40;
  const windowConfig = configStoreRef?.get('window') ?? {
    heightPercent: legacyHeight,
    widthPercent: 100,
    monitor: 'active',
  };

  const heightPercent = windowConfig.heightPercent === 30 && legacyHeight !== 30
    ? legacyHeight
    : windowConfig.heightPercent;

  return {
    ...windowConfig,
    heightPercent: clampHeightPercent(heightPercent ?? legacyHeight),
    widthPercent: clampWidthPercent(windowConfig.widthPercent ?? 100),
    monitor: windowConfig.monitor ?? 'active',
  };
}

function getConfiguredDisplay(monitor: MonitorTarget): Electron.Display {
  if (monitor === 'active') {
    return getActiveDisplay();
  }

  if (monitor === 'primary') {
    return screen.getPrimaryDisplay();
  }

  return screen.getAllDisplays().find((display) => display.id === monitor) ?? screen.getPrimaryDisplay();
}

function calcDimensions(displayOverride?: Electron.Display): {
  display: Electron.Display;
  width: number;
  height: number;
  x: number;
  monitorTop: number;
  hiddenY: number;
} {
  const windowConfig = getConfiguredWindowSettings();
  const display = displayOverride ?? getConfiguredDisplay(windowConfig.monitor);
  const { x, y, width, height } = display.workArea;
  const winWidth = Math.round(width * (windowConfig.widthPercent / 100));
  const winHeight = Math.round(height * (windowConfig.heightPercent / 100));
  const centeredX = x + Math.round((width - winWidth) / 2);

  return {
    display,
    width: winWidth,
    height: winHeight,
    x: centeredX,
    monitorTop: y,
    hiddenY: y - winHeight,
  };
}

function getSettingsDisplay(): Electron.Display {
  if (!isWindowUnavailable(win)) {
    return screen.getDisplayMatching(win.getBounds());
  }

  return getConfiguredDisplay(getConfiguredWindowSettings().monitor);
}

function calcSettingsWindowBounds(displayOverride?: Electron.Display): {
  display: Electron.Display;
  width: number;
  height: number;
  x: number;
  y: number;
} {
  const display = displayOverride ?? getSettingsDisplay();
  const { x, y, width, height } = display.workArea;
  const windowWidth = Math.max(720, Math.min(SETTINGS_WINDOW_WIDTH, width - 48));
  const windowHeight = Math.max(620, Math.min(SETTINGS_WINDOW_HEIGHT, height - 48));

  return {
    display,
    width: windowWidth,
    height: windowHeight,
    x: x + Math.round((width - windowWidth) / 2),
    y: y + Math.round((height - windowHeight) / 2),
  };
}

export function createWindow(configStore: ConfigStore): BrowserWindow {
  configStoreRef = configStore;
  const dims = calcDimensions();

  const createdWindow = new BrowserWindow({
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    show: false,
    width: dims.width,
    height: dims.height,
    x: dims.x,
    y: dims.hiddenY,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win = createdWindow;

  // Apply initial opacity from config (overridden to 1.0 in high contrast)
  const initialOpacity = nativeTheme.shouldUseHighContrastColors
    ? 1.0
    : configStore.get('opacity');
  win.setOpacity(clampOpacity(initialOpacity));

  const acrylicResult = applyAcrylicBlur(configStore.get('acrylicBlur'));
  if (!acrylicResult.success && configStore.get('acrylicBlur')) {
    logger.warn(`Initial acrylic blur application failed: ${acrylicResult.error}`);
  }

  // Listen for high contrast mode changes at runtime
  nativeTheme.on('updated', () => {
    if (!win || win.isDestroyed()) return;
    if (nativeTheme.shouldUseHighContrastColors) {
      win.setOpacity(1.0);
      logger.info('High contrast detected — opacity forced to 1.0');
    } else {
      const opacity = configStoreRef?.get('opacity') ?? 0.85;
      win.setOpacity(clampOpacity(opacity));
      logger.info('High contrast disabled — opacity restored');
    }
  });

  // Load renderer
  void Promise.resolve()
    .then(() => loadRendererWindow(createdWindow))
    .catch((error: unknown) => {
    logger.error('Failed to load renderer window', error);
  });

  // Open devtools in dev mode for debugging
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Intercept close to hide instead of destroy (UX-DR29: hide ≠ close)
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      hide();
    }
  });

  logger.info(
    `Window created: ${dims.width}x${dims.height} at (${dims.x}, ${dims.hiddenY})`,
  );

  // Register display change listeners (screen API is ready after app.whenReady)
  screen.on('display-removed', (_event: Electron.Event, oldDisplay: Electron.Display) => {
    logger.info(`Display removed: ${oldDisplay.id}`);
    if (lastDisplayId === oldDisplay.id && !isWindowUnavailable(win)) {
      applyWindowSettings(screen.getPrimaryDisplay());
      logger.info('Reapplied configured window bounds after display removal');
    }

    if (!isWindowUnavailable(settingsWindow)) {
      const settingsBounds = calcSettingsWindowBounds(screen.getPrimaryDisplay());
      settingsWindow.setBounds({
        x: settingsBounds.x,
        y: settingsBounds.y,
        width: settingsBounds.width,
        height: settingsBounds.height,
      });
    }
  });

  screen.on('display-added', (_event: Electron.Event, newDisplay: Electron.Display) => {
    logger.info(`Display added: ${newDisplay.id}`);
  });

  return win;
}

export function setQuitting(value: boolean): void {
  isQuitting = value;
}

async function animateShow(
  window: BrowserWindow,
  targetY: number,
  duration: number,
): Promise<void> {
  const startY = window.getBounds().y;
  const startTime = performance.now();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const currentY = Math.round(startY + (targetY - startY) * eased);

      const bounds = window.getBounds();
      window.setBounds({ ...bounds, y: currentY });

      if (progress >= 1) {
        clearInterval(interval);
        resolve();
      }
    }, 16); // ~60fps
  });
}

async function animateHide(
  window: BrowserWindow,
  startY: number,
  height: number,
  duration: number,
): Promise<void> {
  const targetY = startY - height;
  const startTime = performance.now();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInCubic(progress);
      const currentY = Math.round(startY + (targetY - startY) * eased);

      const bounds = window.getBounds();
      window.setBounds({ ...bounds, y: currentY });

      if (progress >= 1) {
        clearInterval(interval);
        resolve();
      }
    }, 16); // ~60fps
  });
}

export async function show(): Promise<void> {
  if (!win || visible || animating) return;

  const duration = getEffectiveAnimationSpeed();
  const dims = calcDimensions();

  if (duration <= 0) {
    // Instant mode — no animation, no animating flag
    logger.info('Show instant (animationSpeed=0)');

    win.setBounds({
      x: dims.x,
      y: dims.monitorTop,
      width: dims.width,
      height: dims.height,
    });

    win.showInactive();

    const opacity = configStoreRef?.get('opacity') ?? 0.85;
    win.setOpacity(clampOpacity(opacity));

    visible = true;
  lastDisplayId = dims.display.id;
    win.focus();
    win.webContents.send(CHANNELS.TERMINAL_FOCUS);
    onStateChangeCallback?.(true);
    return;
  }

  animating = true;
  logger.info('Show animation starting');
  const showStart = performance.now();

  // Reposition to active monitor before showing
  win.setBounds({
    x: dims.x,
    y: dims.hiddenY,
    width: dims.width,
    height: dims.height,
  });

  win.showInactive();

  await animateShow(win, dims.monitorTop, duration);

  // Re-apply opacity after show (OS/Electron may reset it)
  const opacity = configStoreRef?.get('opacity') ?? 0.85;
  win.setOpacity(clampOpacity(opacity));

  visible = true;
  animating = false;
  lastDisplayId = dims.display.id;
  win.focus();
  win.webContents.send(CHANNELS.TERMINAL_FOCUS);

  const elapsed = performance.now() - showStart;
  logger.info(`Show animation complete (${elapsed.toFixed(1)}ms)`);

  onStateChangeCallback?.(true);
}

export async function hide(): Promise<void> {
  if (!win || !visible || animating) return;

  closeSettingsWindow();

  // Clear any pending focus-fade timer (Task 6.3: cleanup on any hide method)
  clearFocusFadeTimer();

  const baseSpeed = getEffectiveAnimationSpeed();

  if (baseSpeed <= 0) {
    // Instant mode — no animation, no animating flag
    logger.info('Hide instant (animationSpeed=0)');

    const bounds = win.getBounds();
    win.setBounds({ ...bounds, y: bounds.y - bounds.height });

    win.blur();
    visible = false;
    onStateChangeCallback?.(false);
    return;
  }

  const hideDuration = Math.round(baseSpeed * 0.75);

  animating = true;
  logger.info('Hide animation starting');
  const hideStart = performance.now();

  const bounds = win.getBounds();
  await animateHide(win, bounds.y, bounds.height, hideDuration);

  win.blur();
  visible = false;
  animating = false;

  const elapsed = performance.now() - hideStart;
  logger.info(`Hide animation complete (${elapsed.toFixed(1)}ms)`);

  onStateChangeCallback?.(false);
}

export async function toggle(): Promise<void> {
  if (animating) {
    logger.warn('Toggle rejected — animation in progress');
    return;
  }

  if (visible) {
    await hide();
  } else {
    await show();
  }
}

export function getWindow(): BrowserWindow | null {
  return win;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}

export function isVisible(): boolean {
  return visible;
}

function clampOpacity(value: number): number {
  return Math.min(1.0, Math.max(0.1, value));
}

function clampAnimationSpeed(value: number): number {
  if (value < 0) return 0;
  if (value > 1000) return 1000;
  return value;
}

export function setOpacity(value: number): void {
  if (!win) return;
  // In high contrast mode, always force 100% opacity
  if (nativeTheme.shouldUseHighContrastColors) {
    win.setOpacity(1.0);
    logger.info('High contrast active — opacity override to 1.0');
    return;
  }
  const clamped = clampOpacity(value);
  win.setOpacity(clamped);
  logger.info(`Window opacity set to ${clamped}`);
}

export function applyAcrylicBlur(enabled: boolean): AcrylicBlurResult {
  if (isWindowUnavailable(win)) {
    return { success: false, error: 'Window is not ready' };
  }

  if (typeof win.setBackgroundMaterial !== 'function') {
    return { success: false, error: 'Background materials are not supported on this platform' };
  }

  try {
    win.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
    logger.info(`Background material set to ${enabled ? 'acrylic' : 'none'}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set background material';
    logger.error('Failed to apply acrylic blur:', error);
    return { success: false, error: message };
  }
}

export function applyWindowSettings(displayOverride?: Electron.Display): void {
  if (isWindowUnavailable(win)) return;

  const dims = calcDimensions(displayOverride);
  const y = visible ? dims.monitorTop : dims.hiddenY;

  win.setBounds({
    x: dims.x,
    y,
    width: dims.width,
    height: dims.height,
  });

  lastDisplayId = dims.display.id;

  if (!isWindowUnavailable(settingsWindow)) {
    const settingsBounds = calcSettingsWindowBounds(dims.display);
    settingsWindow.setBounds({
      x: settingsBounds.x,
      y: settingsBounds.y,
      width: settingsBounds.width,
      height: settingsBounds.height,
    });
  }
}

export async function openSettingsWindow(tab?: string): Promise<void> {
  const bounds = calcSettingsWindowBounds();

  clearFocusFadeTimer();

  if (!isWindowUnavailable(settingsWindow)) {
    settingsWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });

    if (tab) {
      await loadRendererWindow(settingsWindow, { view: 'settings', tab });
    }

    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    title: 'QuakeShell Settings',
    show: false,
    frame: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    parent: isWindowUnavailable(win) ? undefined : win,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    backgroundColor: '#13141c',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  await loadRendererWindow(settingsWindow, {
    view: 'settings',
    ...(tab ? { tab } : {}),
  });

  settingsWindow.show();
  settingsWindow.focus();
}

export function closeSettingsWindow(): void {
  if (isWindowUnavailable(settingsWindow)) {
    settingsWindow = null;
    return;
  }

  settingsWindow.close();
}

function clearFocusFadeTimer(): void {
  if (focusFadeTimer !== null) {
    clearTimeout(focusFadeTimer);
    focusFadeTimer = null;
  }
}

export function setupFocusFade(): void {
  if (!win) return;

  // Teardown any existing handlers first
  teardownFocusFade();

  const scheduleFocusFadeHide = (delayMs: number) => {
    clearFocusFadeTimer();
    focusFadeTimer = setTimeout(() => {
      focusFadeTimer = null;
      // Re-check guards after grace period / launch suppression
      if (
        visible
        && !animating
        && !isFocusFadeSuppressed()
        && getFocusFadeShellLaunchSuppressionRemaining() <= 0
        && !isWindowFocused()
      ) {
        void hide();
      }
    }, delayMs);
  };

  blurHandler = () => {
    // Don't trigger focus-fade during animations or when already hidden
    if (animating || !visible) return;

    if (isFocusFadeSuppressed()) {
      clearFocusFadeTimer();
      return;
    }

    scheduleFocusFadeHide(
      FOCUS_FADE_GRACE_PERIOD_MS + getFocusFadeShellLaunchSuppressionRemaining(),
    );
  };

  focusHandler = () => {
    clearFocusFadeTimer();
  };

  win.on('blur', blurHandler);
  win.on('focus', focusHandler);
  logger.info('Focus-fade enabled (300ms grace period)');
}

export function teardownFocusFade(): void {
  if (!win) return;

  clearFocusFadeTimer();

  if (blurHandler) {
    win.removeListener('blur', blurHandler);
    blurHandler = null;
  }
  if (focusHandler) {
    win.removeListener('focus', focusHandler);
    focusHandler = null;
  }
  logger.info('Focus-fade disabled');
}

// -----------------------------------------------------------------------------
// Resize via cursor polling (main-process owned — no renderer coordinate issues)
// -----------------------------------------------------------------------------
let resizePollTimer: ReturnType<typeof setInterval> | null = null;

/** Start polling the cursor position and applying it as the window height. */
export function startResizeDrag(): void {
  if (!win || win.isDestroyed()) return;
  if (resizePollTimer !== null) return; // already polling

  resizePollTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      stopResizeDrag(false);
      return;
    }
    const { y: cursorY } = screen.getCursorScreenPoint();
    applyResize(cursorY);
  }, 16); // ~60fps
}

/** Stop polling and optionally persist the final height. */
export function stopResizeDrag(persist: boolean): void {
  if (resizePollTimer !== null) {
    clearInterval(resizePollTimer);
    resizePollTimer = null;
  }
  if (!persist || !win || win.isDestroyed() || !configStoreRef) return;
  const display = getActiveDisplay();
  const { y: workAreaY, height: workAreaHeight } = display.workArea;
  const currentHeight = win.getBounds().height;
  const clampedPx = clampHeightPx(currentHeight, workAreaY, workAreaHeight);
  const pct = Math.round((clampedPx / workAreaHeight) * 100);
  configStoreRef.set('dropHeight', pct);
  configStoreRef.set('window', {
    ...configStoreRef.get('window'),
    heightPercent: pct,
  });
  logger.info(`Resize drag ended — saved dropHeight=${pct}%`);
}

function clampHeightPx(
  px: number,
  _workAreaY: number,
  workAreaHeight: number,
): number {
  const minPx = Math.round(workAreaHeight * 0.1);
  const maxPx = Math.round(workAreaHeight * 0.9);
  return Math.max(minPx, Math.min(maxPx, Math.round(px)));
}

function applyResize(cursorScreenY: number): void {
  if (!win || win.isDestroyed()) return;
  const display = getActiveDisplay();
  const { y: workAreaY, height: workAreaHeight } = display.workArea;
  // Desired height = distance from work area top to cursor
  const desiredPx = cursorScreenY - workAreaY;
  const clampedPx = clampHeightPx(desiredPx, workAreaY, workAreaHeight);
  const bounds = win.getBounds();
  if (bounds.height !== clampedPx) {
    win.setBounds({ ...bounds, height: clampedPx });
  }
}

export function resetWindowHeight(): void {
  if (!win || win.isDestroyed()) return;
  const defaultPercent = 40;
  if (configStoreRef) {
    configStoreRef.set('dropHeight', defaultPercent);
    configStoreRef.set('window', {
      ...configStoreRef.get('window'),
      heightPercent: defaultPercent,
    });
  }
  const display = getActiveDisplay();
  const { height: workAreaHeight } = display.workArea;
  const targetHeight = Math.round(workAreaHeight * (defaultPercent / 100));
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, height: targetHeight });
}

export function setReducedMotion(value: boolean): void {
  reducedMotion = value;
  logger.info(`Reduced motion set to ${value}`);
}

export function getReducedMotion(): boolean {
  return reducedMotion;
}

function getEffectiveAnimationSpeed(): number {
  if (reducedMotion) return 0;
  return clampAnimationSpeed(configStoreRef?.get('animationSpeed') ?? 200);
}

export function isAnimating(): boolean {
  return animating;
}

/** @internal For test use only */
export function _reset(): void {
  closeSettingsWindow();
  win = null;
  settingsWindow = null;
  visible = false;
  animating = false;
  isQuitting = false;
  configStoreRef = null;
  onStateChangeCallback = null;
  lastDisplayId = null;
  clearFocusFadeTimer();
  blurHandler = null;
  focusHandler = null;
  focusFadeShellLaunchSuppressedUntil = 0;
}
