import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
// NOTE: vi.mock factories are hoisted before variable declarations.
// We must use vi.hoisted() so these fns exist when the factory runs.

const {
  mockTrayDestroy,
  mockTraySetToolTip,
  mockTraySetContextMenu,
  mockTraySetImage,
  mockTrayOn,
  mockAppQuit,
  mockAppGetVersion,
  mockDialogShowMessageBox,
  mockShellOpenPath,
} = vi.hoisted(() => ({
  mockTrayDestroy: vi.fn(),
  mockTraySetToolTip: vi.fn(),
  mockTraySetContextMenu: vi.fn(),
  mockTraySetImage: vi.fn(),
  mockTrayOn: vi.fn(),
  mockAppQuit: vi.fn(),
  mockAppGetVersion: vi.fn(() => '1.2.3'),
  mockDialogShowMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
  mockShellOpenPath: vi.fn(),
}));

vi.mock('electron', () => {
  function MockTray() {
    return {
      destroy: mockTrayDestroy,
      setToolTip: mockTraySetToolTip,
      setContextMenu: mockTraySetContextMenu,
      setImage: mockTraySetImage,
      on: mockTrayOn,
    };
  }

  const Menu = {
    buildFromTemplate: vi.fn((template: unknown[]) => template),
  };

  return {
    Tray: MockTray,
    Menu,
    app: {
      quit: mockAppQuit,
      getVersion: mockAppGetVersion,
    },
    dialog: {
      showMessageBox: mockDialogShowMessageBox,
    },
    nativeImage: {
      createFromPath: vi.fn((p: string) => p),
    },
    shell: {
      openPath: mockShellOpenPath,
    },
  };
});

vi.mock('electron-log/main', () => {
  const scopedLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: {
      scope: vi.fn(() => scopedLogger),
    },
  };
});

import { Menu, nativeImage } from 'electron';
import { createTray, destroyTray, rebuildContextMenu } from './tray-manager';

function getMenuTemplate(): Array<{ label?: string; type?: string; click?: () => void }> {
  return (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.results[
    (Menu.buildFromTemplate as ReturnType<typeof vi.fn>).mock.results.length - 1
  ].value;
}

function findMenuItem(label: string) {
  const template = getMenuTemplate();
  return template.find((item) => item.label?.startsWith(label));
}

describe('main/tray-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTray() — legacy overload', () => {
    it('creates a Tray instance with icon and tooltip', () => {
      const toggleFn = vi.fn();
      createTray(toggleFn);

      expect(mockTraySetToolTip).toHaveBeenCalledWith('QuakeShell');
      expect(mockTraySetContextMenu).toHaveBeenCalled();
    });

    it('registers left-click handler that triggers toggle', () => {
      const toggleFn = vi.fn();
      createTray(toggleFn);

      const clickCall = mockTrayOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      );
      expect(clickCall).toBeDefined();

      const handler = clickCall![1] as () => void;
      handler();
      expect(toggleFn).toHaveBeenCalled();
    });
  });

  describe('createTray() — options overload', () => {
    const defaultOptions = () => ({
      onToggle: vi.fn(),
      getHotkey: vi.fn(() => 'Ctrl+Shift+Q'),
      getConfigPath: vi.fn(() => 'C:\\Users\\test\\config.json'),
      onQuit: vi.fn(),
    });

    it('creates tray with context menu containing all required items in order', () => {
      const opts = defaultOptions();
      createTray(opts);

      const template = getMenuTemplate();
      const labels = template.map((item) => item.label ?? item.type);

      expect(labels).toEqual([
        'Toggle Terminal\tCtrl+Shift+Q',
        'separator',
        'Edit Settings',
        'Check for Updates',
        'separator',
        'About QuakeShell',
        'Quit',
      ]);
    });

    it('Toggle Terminal menu item calls onToggle', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Toggle Terminal');
      item!.click!();
      expect(opts.onToggle).toHaveBeenCalled();
    });

    it('Toggle Terminal shows hotkey label from getHotkey()', () => {
      const opts = defaultOptions();
      opts.getHotkey.mockReturnValue('F12');
      createTray(opts);

      const item = findMenuItem('Toggle Terminal');
      expect(item!.label).toBe('Toggle Terminal\tF12');
    });

    it('Edit Settings calls shell.openPath with config path', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Edit Settings');
      item!.click!();
      expect(mockShellOpenPath).toHaveBeenCalledWith('C:\\Users\\test\\config.json');
    });

    it('About QuakeShell shows a version dialog', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('About QuakeShell');
      item!.click!();

      expect(mockDialogShowMessageBox).toHaveBeenCalledWith({
        type: 'info',
        title: 'About QuakeShell',
        message: 'QuakeShell',
        detail: 'Version 1.2.3',
        buttons: ['OK'],
        noLink: true,
      });
    });

    it('Quit calls onQuit callback (graceful shutdown)', () => {
      const opts = defaultOptions();
      createTray(opts);

      const item = findMenuItem('Quit');
      item!.click!();
      expect(opts.onQuit).toHaveBeenCalled();
    });

    it('left-click handler triggers toggle', () => {
      const opts = defaultOptions();
      createTray(opts);

      const clickCall = mockTrayOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'click',
      );
      const handler = clickCall![1] as () => void;
      handler();
      expect(opts.onToggle).toHaveBeenCalled();
    });
  });

  describe('tray icon', () => {
    it('uses the root application icon', () => {
      createTray(vi.fn());

      const mockCreateFromPath = nativeImage.createFromPath as ReturnType<typeof vi.fn>;
      const iconPath = mockCreateFromPath.mock.calls[0][0];
      expect(iconPath).toMatch(/[\\/]assets[\\/]icon\.ico$/);
    });
  });

  describe('rebuildContextMenu()', () => {
    it('rebuilds context menu with updated hotkey label', () => {
      const opts = {
        onToggle: vi.fn(),
        getHotkey: vi.fn(() => 'Ctrl+Shift+Q'),
        getConfigPath: vi.fn(() => 'C:\\config.json'),
        onQuit: vi.fn(),
      };
      createTray(opts);

      // Change hotkey
      opts.getHotkey.mockReturnValue('F12');
      rebuildContextMenu();

      // Verify menu was rebuilt
      expect(mockTraySetContextMenu).toHaveBeenCalledTimes(2);
      const item = findMenuItem('Toggle Terminal');
      expect(item!.label).toBe('Toggle Terminal\tF12');
    });
  });

  describe('destroyTray()', () => {
    it('destroys the tray instance', () => {
      createTray(vi.fn());
      destroyTray();
      expect(mockTrayDestroy).toHaveBeenCalled();
    });
  });
});
