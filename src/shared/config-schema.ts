import { z } from 'zod';

export const configSchema = z.object({
  hotkey: z.string().default('Ctrl+Shift+Q'),
  defaultShell: z.string().default('powershell'),
  opacity: z.number().min(0).max(1).default(0.85),
  focusFade: z.boolean().default(true),
  animationSpeed: z.number().min(0).max(1000).default(200),
  fontSize: z.number().int().min(8).max(64).default(14),
  fontFamily: z
    .string()
    .default('Cascadia Code, Consolas, Courier New, monospace'),
  lineHeight: z.number().min(1).max(2).default(1.2),
  dropHeight: z.number().min(10).max(100).default(40),
  autostart: z.boolean().default(true),
  firstRun: z.boolean().default(true),
  // --- Phase 2 additions ---
  theme: z.string().default('tokyo-night'),
  window: z
    .object({
      heightPercent: z.number().min(10).max(90).default(30),
      widthPercent: z.number().min(20).max(100).default(100),
      monitor: z
        .union([
          z.literal('active'),
          z.literal('primary'),
          z.number().int().min(0),
        ])
        .default('active'),
    })
    .default({}),
  tabs: z
    .object({
      colorPalette: z
        .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
        .min(1)
        .default([
          '#7aa2f7',
          '#9ece6a',
          '#bb9af7',
          '#e0af68',
          '#7dcfff',
          '#f7768e',
        ]),
      maxTabs: z.number().int().min(1).max(20).default(10),
    })
    .default({}),
  terminal: z
    .object({
      startLocation: z
        .union([
          z.literal('home'),
          z.literal('lastUsed'),
          z.literal('custom'),
        ])
        .default('home'),
      customStartDirectory: z.string().default(''),
    })
    .default({}),
  acrylicBlur: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;

export const configDefaults: Config = configSchema.parse({});
