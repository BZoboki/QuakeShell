import { describe, it, expect } from 'vitest';
import { configSchema, type Config, configDefaults } from './config-schema';

describe('shared/config-schema', () => {
  describe('configSchema', () => {
    it('parses a valid full config', () => {
      const input: Config = {
        hotkey: 'Ctrl+Shift+Q',
        defaultShell: 'powershell',
        opacity: 0.85,
        focusFade: true,
        animationSpeed: 200,
        fontSize: 14,
        fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
        lineHeight: 1.2,
        dropHeight: 30,
        autostart: true,
        firstRun: true,
        theme: 'tokyo-night',
        window: { heightPercent: 30, widthPercent: 100, monitor: 'active' as const },
        tabs: {
          colorPalette: ['#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68', '#7dcfff', '#f7768e'],
          maxTabs: 10,
        },
        terminal: { startLocation: 'home' as const, customStartDirectory: '' },
        acrylicBlur: false,
      };
      const result = configSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it('produces all defaults from an empty object', () => {
      const result = configSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          hotkey: 'Ctrl+Shift+Q',
          defaultShell: 'powershell',
          opacity: 0.85,
          focusFade: true,
          animationSpeed: 200,
          fontSize: 14,
          fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
          lineHeight: 1.2,
          dropHeight: 40,
          autostart: true,
          firstRun: true,
          theme: 'tokyo-night',
          window: { heightPercent: 30, widthPercent: 100, monitor: 'active' },
          tabs: {
            colorPalette: ['#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68', '#7dcfff', '#f7768e'],
            maxTabs: 10,
          },
          terminal: { startLocation: 'home', customStartDirectory: '' },
          acrylicBlur: false,
        });
      }
    });

    it('rejects opacity out of range (too high)', () => {
      const result = configSchema.safeParse({ opacity: 2 });
      expect(result.success).toBe(false);
    });

    it('rejects opacity out of range (too low)', () => {
      const result = configSchema.safeParse({ opacity: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects animationSpeed below minimum', () => {
      const result = configSchema.safeParse({ animationSpeed: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects animationSpeed above maximum', () => {
      const result = configSchema.safeParse({ animationSpeed: 2000 });
      expect(result.success).toBe(false);
    });

    it('rejects fontSize below minimum', () => {
      const result = configSchema.safeParse({ fontSize: 4 });
      expect(result.success).toBe(false);
    });

    it('rejects fontSize above maximum', () => {
      const result = configSchema.safeParse({ fontSize: 72 });
      expect(result.success).toBe(false);
    });

    it('accepts fontSize at the maximum boundary', () => {
      const result = configSchema.safeParse({ fontSize: 64 });
      expect(result.success).toBe(true);
    });

    it('accepts lineHeight at valid boundaries', () => {
      expect(configSchema.safeParse({ lineHeight: 1 }).success).toBe(true);
      expect(configSchema.safeParse({ lineHeight: 2 }).success).toBe(true);
    });

    it('rejects lineHeight below minimum', () => {
      const result = configSchema.safeParse({ lineHeight: 0.8 });
      expect(result.success).toBe(false);
    });

    it('rejects lineHeight above maximum', () => {
      const result = configSchema.safeParse({ lineHeight: 2.5 });
      expect(result.success).toBe(false);
    });

    it('accepts any non-empty fontFamily string', () => {
      const result = configSchema.safeParse({ fontFamily: 'JetBrains Mono' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fontFamily).toBe('JetBrains Mono');
      }
    });

    it('rejects dropHeight below minimum', () => {
      const result = configSchema.safeParse({ dropHeight: 5 });
      expect(result.success).toBe(false);
    });

    it('rejects dropHeight above maximum', () => {
      const result = configSchema.safeParse({ dropHeight: 150 });
      expect(result.success).toBe(false);
    });

    it('retains valid fields and fills missing ones with defaults', () => {
      const result = configSchema.safeParse({
        hotkey: 'Alt+`',
        opacity: 0.5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hotkey).toBe('Alt+`');
        expect(result.data.opacity).toBe(0.5);
        expect(result.data.defaultShell).toBe('powershell');
        expect(result.data.fontSize).toBe(14);
      }
    });

    it('rejects wrong types for boolean fields', () => {
      const result = configSchema.safeParse({ focusFade: 'yes' });
      expect(result.success).toBe(false);
    });

    it('rejects wrong types for string fields', () => {
      const result = configSchema.safeParse({ hotkey: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe('configDefaults', () => {
    it('contains all default values including Phase 2 fields', () => {
      expect(configDefaults).toEqual({
        hotkey: 'Ctrl+Shift+Q',
        defaultShell: 'powershell',
        opacity: 0.85,
        focusFade: true,
        animationSpeed: 200,
        fontSize: 14,
        fontFamily: 'Cascadia Code, Consolas, Courier New, monospace',
        lineHeight: 1.2,
        dropHeight: 40,
        autostart: true,
        firstRun: true,
        theme: 'tokyo-night',
        window: { heightPercent: 30, widthPercent: 100, monitor: 'active' },
        tabs: {
          colorPalette: ['#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68', '#7dcfff', '#f7768e'],
          maxTabs: 10,
        },
        terminal: { startLocation: 'home', customStartDirectory: '' },
        acrylicBlur: false,
      });
    });

    it('preserves v1 default values', () => {
      expect(configDefaults.hotkey).toBe('Ctrl+Shift+Q');
      expect(configDefaults.defaultShell).toBe('powershell');
      expect(configDefaults.opacity).toBe(0.85);
      expect(configDefaults.dropHeight).toBe(40);
    });
  });

  describe('v1 config compatibility', () => {
    const v1Config = {
      hotkey: 'Ctrl+`',
      defaultShell: 'powershell',
      opacity: 0.9,
      focusFade: false,
      animationSpeed: 300,
      fontSize: 16,
      fontFamily: 'Consolas',
      lineHeight: 1.4,
      dropHeight: 50,
      autostart: false,
      firstRun: false,
    };

    it('parses v1 config without error', () => {
      const result = configSchema.safeParse(v1Config);
      expect(result.success).toBe(true);
    });

    it('preserves all v1 field values', () => {
      const result = configSchema.parse(v1Config);
      expect(result.hotkey).toBe('Ctrl+`');
      expect(result.defaultShell).toBe('powershell');
      expect(result.opacity).toBe(0.9);
      expect(result.focusFade).toBe(false);
      expect(result.animationSpeed).toBe(300);
      expect(result.fontSize).toBe(16);
      expect(result.fontFamily).toBe('Consolas');
      expect(result.lineHeight).toBe(1.4);
      expect(result.dropHeight).toBe(50);
      expect(result.autostart).toBe(false);
      expect(result.firstRun).toBe(false);
    });

    it('fills Phase 2 defaults for missing keys', () => {
      const result = configSchema.parse(v1Config);
      expect(result.theme).toBe('tokyo-night');
      expect(result.window.widthPercent).toBe(100);
      expect(result.window.monitor).toBe('active');
      expect(result.tabs.maxTabs).toBe(10);
      expect(result.acrylicBlur).toBe(false);
    });

    it('fills lineHeight with the Phase 2 default when missing', () => {
      const { lineHeight } = configSchema.parse({ hotkey: 'Ctrl+`' });
      expect(lineHeight).toBe(1.2);
    });

    it('preserves dropHeight alongside new window.heightPercent', () => {
      const result = configSchema.parse(v1Config);
      expect(result.dropHeight).toBe(50);
      expect(result.window.heightPercent).toBe(30);
    });
  });

  describe('Phase 2: window.widthPercent validation', () => {
    it('rejects 999 (above max 100)', () => {
      const result = configSchema.safeParse({ window: { widthPercent: 999 } });
      expect(result.success).toBe(false);
    });

    it('rejects 19 (below min 20)', () => {
      const result = configSchema.safeParse({ window: { widthPercent: 19 } });
      expect(result.success).toBe(false);
    });

    it('accepts 20 (min boundary)', () => {
      const result = configSchema.safeParse({ window: { widthPercent: 20 } });
      expect(result.success).toBe(true);
    });

    it('accepts 100 (max boundary)', () => {
      const result = configSchema.safeParse({ window: { widthPercent: 100 } });
      expect(result.success).toBe(true);
    });
  });

  describe('Phase 2: window.monitor validation', () => {
    it('accepts "active"', () => {
      const result = configSchema.safeParse({ window: { monitor: 'active' } });
      expect(result.success).toBe(true);
    });

    it('accepts "primary"', () => {
      const result = configSchema.safeParse({ window: { monitor: 'primary' } });
      expect(result.success).toBe(true);
    });

    it('accepts integer 0', () => {
      const result = configSchema.safeParse({ window: { monitor: 0 } });
      expect(result.success).toBe(true);
    });

    it('accepts integer 1', () => {
      const result = configSchema.safeParse({ window: { monitor: 1 } });
      expect(result.success).toBe(true);
    });

    it('accepts integer 2', () => {
      const result = configSchema.safeParse({ window: { monitor: 2 } });
      expect(result.success).toBe(true);
    });

    it('rejects "secondary"', () => {
      const result = configSchema.safeParse({ window: { monitor: 'secondary' } });
      expect(result.success).toBe(false);
    });

    it('rejects -1', () => {
      const result = configSchema.safeParse({ window: { monitor: -1 } });
      expect(result.success).toBe(false);
    });

    it('rejects 3.5 (non-integer)', () => {
      const result = configSchema.safeParse({ window: { monitor: 3.5 } });
      expect(result.success).toBe(false);
    });
  });

  describe('Phase 2: tabs.colorPalette validation', () => {
    it('rejects array with non-hex-color string', () => {
      const result = configSchema.safeParse({ tabs: { colorPalette: ['red'] } });
      expect(result.success).toBe(false);
    });

    it('rejects array with invalid hex (missing #)', () => {
      const result = configSchema.safeParse({ tabs: { colorPalette: ['7aa2f7'] } });
      expect(result.success).toBe(false);
    });

    it('accepts valid hex colors', () => {
      const result = configSchema.safeParse({ tabs: { colorPalette: ['#abcdef', '#123456'] } });
      expect(result.success).toBe(true);
    });
  });

  describe('Phase 2: tabs.maxTabs validation', () => {
    it('rejects 21 (above max 20)', () => {
      const result = configSchema.safeParse({ tabs: { maxTabs: 21 } });
      expect(result.success).toBe(false);
    });

    it('rejects 0 (below min 1)', () => {
      const result = configSchema.safeParse({ tabs: { maxTabs: 0 } });
      expect(result.success).toBe(false);
    });

    it('accepts 1 (min boundary)', () => {
      const result = configSchema.safeParse({ tabs: { maxTabs: 1 } });
      expect(result.success).toBe(true);
    });

    it('accepts 20 (max boundary)', () => {
      const result = configSchema.safeParse({ tabs: { maxTabs: 20 } });
      expect(result.success).toBe(true);
    });
  });
});
