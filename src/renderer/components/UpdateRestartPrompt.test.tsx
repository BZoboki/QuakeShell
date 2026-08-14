// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('./UpdateRestartPrompt.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, property) => String(property),
  }),
}));

type WindowStatePayload = { visible: boolean };
type PendingUpdatePayload = { version: string; source: 'background-install' };
type UpdateOperationState = {
  phase: 'checking' | 'available' | 'installing' | 'ready-to-restart' | 'up-to-date' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  action: 'install' | 'download' | 'restart' | null;
  error?: string;
};

let windowStateListener: ((payload: WindowStatePayload) => void) | null = null;
let updateReadyListener: ((payload: PendingUpdatePayload | null) => void) | null = null;

const mockGetPendingUpdate = vi.fn<() => Promise<PendingUpdatePayload | null>>();
const mockGetVersion = vi.fn<() => Promise<string>>();
const mockGetUpdateOperation = vi.fn<() => Promise<UpdateOperationState | null>>();
const mockRestartPendingUpdate = vi.fn<() => Promise<boolean>>();
const mockDelayPendingUpdate = vi.fn<() => Promise<PendingUpdatePayload | null>>();

async function flushPromises() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function loadPrompt() {
  const module = await import('./UpdateRestartPrompt');
  return module.default;
}

function getButtonByText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label) as HTMLButtonElement | null;
}

describe('renderer/UpdateRestartPrompt', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    windowStateListener = null;
    updateReadyListener = null;

    mockGetPendingUpdate.mockResolvedValue(null);
    mockGetVersion.mockResolvedValue('1.0.19');
    mockGetUpdateOperation.mockResolvedValue(null);
    mockRestartPendingUpdate.mockResolvedValue(true);
    mockDelayPendingUpdate.mockResolvedValue({ version: '2.0.0', source: 'background-install' });

    Object.defineProperty(window, 'quakeshell', {
      configurable: true,
      writable: true,
      value: {
        window: {
          onStateChanged: vi.fn((callback: (payload: WindowStatePayload) => void) => {
            windowStateListener = callback;
            return vi.fn();
          }),
        },
        app: {
          getVersion: mockGetVersion,
          getUpdateOperation: mockGetUpdateOperation,
          onUpdateOperationChanged: vi.fn(() => vi.fn()),
          getPendingUpdate: mockGetPendingUpdate,
          onUpdateReady: vi.fn((callback: (payload: PendingUpdatePayload | null) => void) => {
            updateReadyListener = callback;
            return vi.fn();
          }),
          restartPendingUpdate: mockRestartPendingUpdate,
          delayPendingUpdate: mockDelayPendingUpdate,
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

  it('shows the restart prompt when a pending update exists and the dropdown opens', async () => {
    mockGetPendingUpdate.mockResolvedValue({ version: '2.0.0', source: 'background-install' });
    const UpdateRestartPrompt = await loadPrompt();

    await act(async () => {
      render(<UpdateRestartPrompt />, container);
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('2.0.0');
    expect(dialog?.textContent).toContain('is installed and ready to apply');
    expect(dialog?.textContent).not.toContain('in the background');
  });

  it('waits for a later reopen when the update becomes ready while the dropdown is already visible', async () => {
    const UpdateRestartPrompt = await loadPrompt();

    await act(async () => {
      render(<UpdateRestartPrompt />, container);
    });
    await flushPromises();

    await act(async () => {
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    await act(async () => {
      updateReadyListener?.({ version: '2.0.0', source: 'background-install' });
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      windowStateListener?.({ visible: false });
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('uses ready-to-restart operation state without interrupting the current visible session', async () => {
    mockGetUpdateOperation.mockResolvedValue({
      phase: 'ready-to-restart',
      currentVersion: '1.0.19',
      latestVersion: '2.0.0',
      action: 'restart',
    });
    const UpdateRestartPrompt = await loadPrompt();

    await act(async () => {
      render(<UpdateRestartPrompt />, container);
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('2.0.0');
  });

  it('hides on Later and re-prompts on the next dropdown open', async () => {
    mockGetPendingUpdate.mockResolvedValue({ version: '2.0.0', source: 'background-install' });
    const UpdateRestartPrompt = await loadPrompt();

    await act(async () => {
      render(<UpdateRestartPrompt />, container);
    });
    await flushPromises();

    await act(async () => {
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    const laterButton = getButtonByText(container, 'Later');
    expect(laterButton).not.toBeNull();

    await act(async () => {
      laterButton?.click();
    });
    await flushPromises();

    expect(mockDelayPendingUpdate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      windowStateListener?.({ visible: false });
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('calls restartPendingUpdate when Restart now is clicked', async () => {
    mockGetPendingUpdate.mockResolvedValue({ version: '2.0.0', source: 'background-install' });
    const UpdateRestartPrompt = await loadPrompt();

    await act(async () => {
      render(<UpdateRestartPrompt />, container);
    });
    await flushPromises();

    await act(async () => {
      windowStateListener?.({ visible: true });
    });
    await flushPromises();

    const restartButton = getButtonByText(container, 'Restart now');
    expect(restartButton).not.toBeNull();

    await act(async () => {
      restartButton?.click();
    });
    await flushPromises();

    expect(mockRestartPendingUpdate).toHaveBeenCalledTimes(1);
  });
});