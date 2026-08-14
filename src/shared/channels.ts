/** IPC channel constants — domain:action naming convention */
export const CHANNELS = {
  // Config
  CONFIG_GET_ALL: 'config:get-all',
  CONFIG_SET: 'config:set',
  CONFIG_GET: 'config:get',
  CONFIG_CHANGED: 'config:changed',
  CONFIG_OPEN_FILE: 'config:open-file',

  // Theme
  THEME_LIST: 'theme:list',
  THEME_SET: 'theme:set',
  THEME_GET_ACTIVE: 'theme:get-active',
  THEME_GET_CURRENT: 'theme:get-current',
  THEME_CHANGED: 'theme:changed',

  // Terminal (placeholder — Story 1.3)
  TERMINAL_SPAWN: 'terminal:spawn',
  // DEPRECATED: TERMINAL_WRITE replaced by TAB_INPUT (Phase 2 — Story P2-1.2)
  // DEPRECATED: TERMINAL_DATA replaced by TAB_DATA (Phase 2 — Story P2-1.2)
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_PROCESS_EXIT: 'terminal:process-exit',
  TERMINAL_RESPAWN: 'terminal:respawn',
  TERMINAL_FOCUS: 'terminal:focus',

  // Tab I/O (replaces TERMINAL_DATA / TERMINAL_WRITE)
  TAB_DATA: 'tab:data',
  TAB_INPUT: 'tab:input',
  TAB_RESIZE: 'tab:resize',
  // Tab lifecycle (renderer → main, invoke)
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_RENAME: 'tab:rename',
  TAB_REORDER: 'tab:reorder',
  TAB_LIST: 'tab:list',
  TAB_SPAWN: 'tab:spawn',
  TAB_AVAILABLE_SHELLS: 'tab:available-shells',
  TAB_CREATE_SPLIT: 'tab:create-split',
  TAB_REFRESH_ENVIRONMENT: 'tab:refresh-environment',
  // Tab events (main → renderer, send)
  TAB_CLOSED: 'tab:closed',
  TAB_ACTIVE_CHANGED: 'tab:active-changed',
  TAB_RENAMED: 'tab:renamed',
  TAB_EXITED: 'tab:exited',
  TAB_AUTO_NAME: 'tab:auto-name',

  // Window (placeholder — Story 1.4)
  WINDOW_TOGGLE: 'window:toggle',
  WINDOW_STATE_CHANGED: 'window:state-changed',
  WINDOW_OPEN_SETTINGS: 'window:open-settings',
  WINDOW_CLOSE_SETTINGS: 'window:close-settings',
  WINDOW_RESIZE: 'window:resize',
  WINDOW_RESIZE_END: 'window:resize-end',
  WINDOW_RESIZE_RESET: 'window:resize-reset',
  WINDOW_SET_REDUCED_MOTION: 'window:set-reduced-motion',
  WINDOW_SET_ACRYLIC_BLUR: 'window:set-acrylic-blur',

  // Hotkey
  HOTKEY_REREGISTER: 'hotkey:reregister',

  // Platform
  PLATFORM_IS_ACRYLIC_SUPPORTED: 'platform:is-acrylic-supported',
  PLATFORM_GET_TERMINAL_PTY_INFO: 'platform:get-terminal-pty-info',

  // Display
  DISPLAY_GET_ALL: 'display:get-all',

  // App (placeholder — Story 3.1+)
  APP_QUIT: 'app:quit',
  APP_GET_VERSION: 'app:get-version',
  APP_GET_UPDATE_OPERATION: 'app:get-update-operation',
  APP_UPDATE_OPERATION_CHANGED: 'app:update-operation-changed',
  APP_CHECK_FOR_UPDATES: 'app:check-for-updates',
  APP_START_AVAILABLE_UPDATE: 'app:start-available-update',
  APP_OPEN_AVAILABLE_UPDATE_DOWNLOAD: 'app:open-available-update-download',
  APP_CHECK_WSL: 'app:check-wsl',
  APP_GET_PENDING_UPDATE: 'app:get-pending-update',
  APP_UPDATE_READY: 'app:update-ready',
  APP_RESTART_PENDING_UPDATE: 'app:restart-pending-update',
  APP_DELAY_PENDING_UPDATE: 'app:delay-pending-update',
  APP_REGISTER_CONTEXT_MENU: 'app:register-context-menu',
  APP_DEREGISTER_CONTEXT_MENU: 'app:deregister-context-menu',
  APP_CONTEXT_MENU_STATUS: 'app:context-menu-status',
} as const;
