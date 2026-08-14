import { effect, signal } from '@preact/signals';
import type { PendingUpdatePayload, UpdateOperationState } from '../../shared/ipc-types';
import { visibleSessionId } from './window-store';

export const pendingUpdate = signal<PendingUpdatePayload | null>(null);
export const isRestartPromptVisible = signal(false);
export const installedVersion = signal<string | null>(null);
export const updateOperation = signal<UpdateOperationState | null>(null);

let unsubscribe: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
let unsubscribeUpdateOperation: (() => void) | null = null;
let updateOperationInitPromise: Promise<void> | null = null;
let lastHandledVisibleSessionId = visibleSessionId.value;

effect(() => {
  const sessionId = visibleSessionId.value;

  if (sessionId === lastHandledVisibleSessionId) {
    return;
  }

  lastHandledVisibleSessionId = sessionId;

  if (pendingUpdate.peek()) {
    isRestartPromptVisible.value = true;
  }
});

effect(() => {
  if (!pendingUpdate.value) {
    isRestartPromptVisible.value = false;
  }
});

function syncPendingUpdateFromOperation(state: UpdateOperationState | null): void {
  if (state?.phase !== 'ready-to-restart' || !state.latestVersion) {
    return;
  }

  pendingUpdate.value = {
    version: state.latestVersion,
    source: 'background-install',
  };
}

export function applyUpdateOperationState(state: UpdateOperationState | null): void {
  updateOperation.value = state;
  syncPendingUpdateFromOperation(state);
}

export function initUpdateStore(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    let sawRealtimeEvent = false;

    unsubscribe = window.quakeshell.app.onUpdateReady((payload) => {
      sawRealtimeEvent = true;
      pendingUpdate.value = payload;
    });

    const initialPendingUpdate = await window.quakeshell.app.getPendingUpdate();
    if (!sawRealtimeEvent) {
      pendingUpdate.value = initialPendingUpdate;
    }
  })().catch((error) => {
    unsubscribe?.();
    unsubscribe = null;
    initPromise = null;
    throw error;
  });

  return initPromise;
}

export function initUpdateOperationStore(): Promise<void> {
  if (updateOperationInitPromise) {
    return updateOperationInitPromise;
  }

  updateOperationInitPromise = (async () => {
    let sawRealtimeEvent = false;

    unsubscribeUpdateOperation = window.quakeshell.app.onUpdateOperationChanged((state) => {
      sawRealtimeEvent = true;
      applyUpdateOperationState(state);
    });

    const [version, initialState] = await Promise.all([
      window.quakeshell.app.getVersion(),
      window.quakeshell.app.getUpdateOperation(),
    ]);

    installedVersion.value = version;
    if (!sawRealtimeEvent) {
      applyUpdateOperationState(initialState);
    }
  })().catch((error) => {
    unsubscribeUpdateOperation?.();
    unsubscribeUpdateOperation = null;
    updateOperationInitPromise = null;
    throw error;
  });

  return updateOperationInitPromise;
}

export async function delayPendingUpdateRestart(): Promise<PendingUpdatePayload | null> {
  const result = await window.quakeshell.app.delayPendingUpdate();
  isRestartPromptVisible.value = false;
  return result;
}

export async function restartPendingUpdateNow(): Promise<boolean> {
  return window.quakeshell.app.restartPendingUpdate();
}

window.addEventListener('unload', () => {
  unsubscribe?.();
  unsubscribe = null;
  initPromise = null;
  unsubscribeUpdateOperation?.();
  unsubscribeUpdateOperation = null;
  updateOperationInitPromise = null;
});