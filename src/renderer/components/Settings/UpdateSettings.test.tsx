// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('./UpdateSettings.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

vi.mock('./SettingsRow.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

type UpdateOperation = {
  phase: 'checking' | 'available' | 'installing' | 'ready-to-restart' | 'up-to-date' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  action: 'install' | 'download' | 'restart' | null;
  error?: string;
};

let updateOperationListener: ((state: UpdateOperation | null) => void) | null = null;
const mockGetVersion = vi.fn<() => Promise<string>>();
const mockGetUpdateOperation = vi.fn<() => Promise<UpdateOperation | null>>();
const mockCheckForUpdates = vi.fn<() => Promise<UpdateOperation | null>>();
const mockStartAvailableUpdate = vi.fn<() => Promise<UpdateOperation | null>>();
const mockOpenAvailableUpdateDownload = vi.fn<() => Promise<boolean>>();
const mockRestartPendingUpdate = vi.fn<() => Promise<boolean>>();

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function loadUpdateSettings() {
  const module = await import('./UpdateSettings');
  return module.default;
}

function getButtonByText(container: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement;
}

describe('UpdateSettings', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    updateOperationListener = null;
    mockGetVersion.mockResolvedValue('1.0.19');
    mockGetUpdateOperation.mockResolvedValue(null);
    mockCheckForUpdates.mockResolvedValue(null);
    mockStartAvailableUpdate.mockResolvedValue(null);
    mockOpenAvailableUpdateDownload.mockResolvedValue(true);
    mockRestartPendingUpdate.mockResolvedValue(true);

    Object.defineProperty(window, 'quakeshell', {
      configurable: true,
      writable: true,
      value: {
        window: {
          onStateChanged: vi.fn(() => vi.fn()),
        },
        app: {
          getVersion: mockGetVersion,
          getUpdateOperation: mockGetUpdateOperation,
          checkForUpdates: mockCheckForUpdates,
          startAvailableUpdate: mockStartAvailableUpdate,
          openAvailableUpdateDownload: mockOpenAvailableUpdateDownload,
          onUpdateOperationChanged: vi.fn((callback: (state: UpdateOperation | null) => void) => {
            updateOperationListener = callback;
            return vi.fn();
          }),
          restartPendingUpdate: mockRestartPendingUpdate,
        },
      },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
  });

  it('shows the installed version and the initial update state', async () => {
    mockGetUpdateOperation.mockResolvedValueOnce({
      phase: 'available',
      currentVersion: '1.0.19',
      latestVersion: '1.0.20',
      action: 'install',
    });
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    expect(container.textContent).toContain('1.0.19');
    expect(container.textContent).toContain('Version 1.0.20 is available to install.');
    expect(getButtonByText(container, 'Install Update')).not.toBeNull();
  });

  it('routes only the main-provided update action', async () => {
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'available',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'download',
      });
    });
    await flush();

    getButtonByText(container, 'Download Update').click();
    await flush();
    expect(mockOpenAvailableUpdateDownload).toHaveBeenCalledTimes(1);

    await act(async () => {
      updateOperationListener?.({
        phase: 'ready-to-restart',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'restart',
      });
    });
    await flush();

    getButtonByText(container, 'Restart now').click();
    await flush();
    expect(mockRestartPendingUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows installing progress and disables the current action', async () => {
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'installing',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: null,
      });
    });
    await flush();

    const installingButton = getButtonByText(container, 'Installing...');
    expect(container.textContent).toContain('Installing version 1.0.20.');
    expect(installingButton.disabled).toBe(true);
  });

  it('starts an available install and adopts its ready-to-restart result', async () => {
    mockStartAvailableUpdate.mockResolvedValueOnce({
      phase: 'ready-to-restart',
      currentVersion: '1.0.19',
      latestVersion: '1.0.20',
      action: 'restart',
    });
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'available',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'install',
      });
    });
    await flush();

    getButtonByText(container, 'Install Update').click();
    await flush();

    expect(mockStartAvailableUpdate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Version 1.0.20 is ready to restart.');
    expect(getButtonByText(container, 'Restart now')).not.toBeNull();
  });

  it('shows an actionable manual-check error with a retry control', async () => {
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'error',
        currentVersion: '1.0.19',
        latestVersion: null,
        action: null,
        error: 'Network unavailable',
      });
    });
    await flush();

    expect(container.textContent).toContain('Network unavailable');
    getButtonByText(container, 'Check for Updates').click();
    await flush();
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it('offers a direct retry after a failed manual install', async () => {
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'error',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'install',
        error: 'npm install failed',
      });
    });
    await flush();

    expect(container.textContent).toContain('Update installation failed.');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('npm install failed');
    getButtonByText(container, 'Retry Install Update').click();
    await flush();
    expect(mockStartAvailableUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports Boolean download and restart action failures', async () => {
    mockOpenAvailableUpdateDownload.mockResolvedValueOnce(false);
    mockRestartPendingUpdate.mockResolvedValueOnce(false);
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    await act(async () => {
      updateOperationListener?.({
        phase: 'available',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'download',
      });
    });
    await flush();

    getButtonByText(container, 'Download Update').click();
    await flush();
    expect(container.textContent).toContain('Unable to open the download page. Try again.');

    await act(async () => {
      updateOperationListener?.({
        phase: 'ready-to-restart',
        currentVersion: '1.0.19',
        latestVersion: '1.0.20',
        action: 'restart',
      });
    });
    await flush();

    getButtonByText(container, 'Restart now').click();
    await flush();
    expect(container.textContent).toContain('Unable to restart QuakeShell. Try again.');
  });

  it('allows retrying a failed initial status load', async () => {
    mockGetVersion.mockRejectedValueOnce(new Error('IPC unavailable'));
    mockGetVersion.mockResolvedValue('1.0.19');
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    expect(container.textContent).toContain('IPC unavailable');
    getButtonByText(container, 'Retry Loading Updates').click();
    await flush();

    expect(mockGetVersion).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('1.0.19');
  });

  it('adopts a manual check result when the matching update event is delayed', async () => {
    mockCheckForUpdates.mockResolvedValueOnce({
      phase: 'available',
      currentVersion: '1.0.19',
      latestVersion: '1.0.20',
      action: 'install',
    });
    const UpdateSettings = await loadUpdateSettings();

    await act(async () => {
      render(<UpdateSettings />, container);
    });
    await flush();

    getButtonByText(container, 'Check for Updates').click();
    await flush();

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Version 1.0.20 is available to install.');
    expect(getButtonByText(container, 'Install Update')).not.toBeNull();
  });
});