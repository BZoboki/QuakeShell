import { describe, expect, it } from 'vitest';
import config, { ignoreNonPackagedRuntimeFiles } from './forge.config';

describe('forge rebuildConfig', () => {
  it('skips rebuilding node-pty because the shipped prebuild works with Electron', () => {
    expect(config.rebuildConfig).toMatchObject({
      ignoreModules: ['node-pty'],
    });
  });
});

describe('forge packagerConfig', () => {
  it('uses the root ICO as the Windows application icon', () => {
    expect(config.packagerConfig).toMatchObject({
      icon: './assets/icon.ico',
    });
  });
});

describe('forge ignoreNonPackagedRuntimeFiles', () => {
  it('preserves the source renderer build tree needed by packaged releases', () => {
    expect(ignoreNonPackagedRuntimeFiles('src')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('src/renderer')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('src/renderer/.vite/renderer/main_window/index.html')).toBe(false);
  });

  it('ignores non-runtime source files that should not be packaged', () => {
    expect(ignoreNonPackagedRuntimeFiles('src/main')).toBe(true);
    expect(ignoreNonPackagedRuntimeFiles('src/main/index.ts')).toBe(true);
    expect(ignoreNonPackagedRuntimeFiles('src/renderer/components/App.tsx')).toBe(true);
  });

  it('preserves runtime roots even when packager passes absolute temp paths', () => {
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/src/renderer/.vite/renderer/main_window/index.html')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/src/renderer')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/.vite/build/index.js')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/node_modules/node-pty/lib/index.js')).toBe(false);
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/assets/icon.ico')).toBe(false);
  });

  it('preserves the root application icon needed by packaged releases', () => {
    expect(ignoreNonPackagedRuntimeFiles('assets/icon.ico')).toBe(false);
  });

  it('still ignores unrelated absolute temp paths', () => {
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/src/main/index.ts')).toBe(true);
    expect(ignoreNonPackagedRuntimeFiles('C:/Temp/app/assets/icon.png')).toBe(true);
  });
});