/** Configuration TypeScript types — re-exported from config-schema.ts */
export type { Config } from './config-schema';
import type { Config } from './config-schema';
export type WindowConfig = Config['window'];
export type TabsConfig = Config['tabs'];
export type TerminalConfig = Config['terminal'];
export type MonitorTarget = Config['window']['monitor'];
