import { describe, it, expect } from 'vitest';
import { APP_NAME, APP_ID, WINDOWS_APP_USER_MODEL_ID } from './constants';
import { CHANNELS } from './channels';

describe('shared/constants', () => {
  it('exports APP_NAME', () => {
    expect(APP_NAME).toBe('QuakeShell');
  });

  it('exports APP_ID', () => {
    expect(APP_ID).toBe('com.quakeshell.app');
  });

  it('exports the Windows AppUserModelID matching the packaged shortcut', () => {
    expect(WINDOWS_APP_USER_MODEL_ID).toBe('electron.app.quakeshell');
  });
});

describe('shared/channels', () => {
  it('exports CHANNELS as an object', () => {
    expect(CHANNELS).toBeDefined();
    expect(typeof CHANNELS).toBe('object');
  });

  it('contains config channels with domain:action format', () => {
    expect(CHANNELS.CONFIG_GET_ALL).toBe('config:get-all');
    expect(CHANNELS.CONFIG_SET).toBe('config:set');
    expect(CHANNELS.CONFIG_GET).toBe('config:get');
  });

  it('contains terminal channels (spawn, resize, respawn)', () => {
    expect(CHANNELS.TERMINAL_SPAWN).toBe('terminal:spawn');
    expect(CHANNELS.TERMINAL_RESIZE).toBe('terminal:resize');
    expect(CHANNELS.TERMINAL_PROCESS_EXIT).toBe('terminal:process-exit');
    expect(CHANNELS.TERMINAL_RESPAWN).toBe('terminal:respawn');
  });

  it('contains tab channels replacing terminal data/write', () => {
    expect(CHANNELS.TAB_DATA).toBe('tab:data');
    expect(CHANNELS.TAB_INPUT).toBe('tab:input');
    expect(CHANNELS.TAB_CREATE).toBe('tab:create');
    expect(CHANNELS.TAB_CLOSE).toBe('tab:close');
    expect(CHANNELS.TAB_SWITCH).toBe('tab:switch');
    expect(CHANNELS.TAB_RENAME).toBe('tab:rename');
    expect(CHANNELS.TAB_LIST).toBe('tab:list');
    expect(CHANNELS.TAB_CREATE_SPLIT).toBe('tab:create-split');
    expect(CHANNELS.TAB_REFRESH_ENVIRONMENT).toBe('tab:refresh-environment');
    expect(CHANNELS.TAB_EXITED).toBe('tab:exited');
    expect(CHANNELS.TAB_AUTO_NAME).toBe('tab:auto-name');
  });

  it('contains placeholder window channels', () => {
    expect(CHANNELS.WINDOW_TOGGLE).toBe('window:toggle');
    expect(CHANNELS.WINDOW_STATE_CHANGED).toBe('window:state-changed');
  });

  it('contains placeholder app channels', () => {
    expect(CHANNELS.APP_QUIT).toBe('app:quit');
    expect(CHANNELS.APP_GET_VERSION).toBe('app:get-version');
    expect(CHANNELS.APP_GET_UPDATE_OPERATION).toBe('app:get-update-operation');
    expect(CHANNELS.APP_UPDATE_OPERATION_CHANGED).toBe('app:update-operation-changed');
    expect(CHANNELS.APP_CHECK_FOR_UPDATES).toBe('app:check-for-updates');
    expect(CHANNELS.APP_START_AVAILABLE_UPDATE).toBe('app:start-available-update');
    expect(CHANNELS.APP_OPEN_AVAILABLE_UPDATE_DOWNLOAD).toBe('app:open-available-update-download');
    expect(CHANNELS.APP_GET_PENDING_UPDATE).toBe('app:get-pending-update');
    expect(CHANNELS.APP_UPDATE_READY).toBe('app:update-ready');
    expect(CHANNELS.APP_RESTART_PENDING_UPDATE).toBe('app:restart-pending-update');
    expect(CHANNELS.APP_DELAY_PENDING_UPDATE).toBe('app:delay-pending-update');
  });

  it('all channel values follow domain:action convention', () => {
    const channelPattern = /^[a-z]+:[a-z][-a-z]*$/;
    for (const value of Object.values(CHANNELS)) {
      expect(value).toMatch(channelPattern);
    }
  });
});
