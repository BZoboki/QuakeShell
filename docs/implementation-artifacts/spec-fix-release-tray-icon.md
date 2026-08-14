---
title: 'Ship tray icons in packaged releases'
type: 'bugfix'
created: '2026-08-13'
status: 'draft'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** QuakeShell displays an empty Windows tray icon in packaged releases. The main-process tray manager resolves the light and dark ICO files at `assets/tray` relative to the application bundle, but Forge's package filter currently omits that directory, so `nativeImage.createFromPath()` receives a nonexistent file path.

**Approach:** Retain only the two runtime tray-icon assets inside `app.asar` at their existing paths, preserving the current development and system-theme behavior. Add automated package-payload checks so a future package configuration change cannot silently ship a blank tray icon again.

## Boundaries & Constraints

**Always:** Keep `assets/tray/icon-dark.ico` and `assets/tray/icon-light.ico` inside the packaged ASAR; preserve the current `getIconPath()` resolution, theme-change listener, and development behavior; retain the existing exclusion of unrelated source and asset files; prove both icons are present through focused tests and a real package build.

**Ask First:** If Forge cannot retain the `assets/tray` subtree without broadening the shipped asset set, changing the runtime icon lookup to an external resource, or altering release packaging conventions, stop for a decision.

**Never:** Do not replace or redraw icon artwork, move all `assets` into the package, add an `extraResource` copy without updating the matching runtime path, weaken ASAR or fuse settings, or change tray interaction and menu behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Normal package | Forge packages the Windows app | Both light and dark ICO entries exist at `assets/tray/` inside `resources/app.asar`; the current tray path resolves without a runtime code change | N/A |
| Theme selection | Windows is dark or light when the packaged app starts or changes theme | The existing tray manager selects the corresponding dark or light ICO and updates the displayed image on theme change | Existing Electron tray behavior remains unchanged |
| Packaging regression | A release artifact lacks either required ICO entry | The release-payload assertion fails with a clear missing-icon error before an archive is produced | Fail the release packaging command rather than producing a broken artifact |

</frozen-after-approval>

## Code Map

- `forge.config.ts` -- owns the ASAR ignore policy through `PACKAGED_RUNTIME_ROOTS` and `ignoreNonPackagedRuntimeFiles`; retain only the tray icon subtree alongside existing Vite and `node-pty` payloads.
- `forge.config.test.ts` -- verifies the package filter; change its tray assertion from excluded to retained and cover both ICO variants without allowing unrelated assets.
- `src/main/tray-manager.ts` -- read-only runtime consumer; `getIconPath()` resolves `../../assets/tray/icon-{theme}.ico` from `.vite/build`, which is valid in development and in an ASAR containing `assets/tray`.
- `src/main/tray-manager.test.ts` -- read-only behavioral coverage for dark/light selection and theme updates; these tests establish that no tray-manager behavior change is required.
- `scripts/npm/package-release.js` -- validates the packaged executable, renderer, and native PTY payload before creating a release ZIP; add a tray-icon ASAR assertion and call it from `buildReleaseAsset()`.
- `scripts/npm/package-release.test.js` -- follows the existing injected-ASAR-list test pattern; cover both-present success and a missing-icon failure.
- `package.json` -- exposes `npm run package` for a local Electron Forge package build and `npm run release:dry-run` for the wrapper release path.

## Tasks & Acceptance

**Execution:**
- [ ] `forge.config.ts`, `forge.config.test.ts` -- whitelist `assets/tray` as a narrowly scoped packaged runtime root and prove both required ICO files survive the ignore policy while neighboring assets remain excluded.
- [ ] `scripts/npm/package-release.js`, `scripts/npm/package-release.test.js` -- validate both icon entries in `app.asar` during release-asset generation, with explicit success and missing-entry tests.
- [ ] `src/main/tray-manager.ts`, `src/main/tray-manager.test.ts` -- leave runtime code unchanged unless the package-path evidence disproves the ASAR contract; retain existing theme-selection regression coverage.

**Acceptance Criteria:**
- Given a Windows package build, when its `resources/app.asar` is listed, then it contains `assets/tray/icon-dark.ico` and `assets/tray/icon-light.ico`.
- Given the packaged executable starts under either Windows theme, when QuakeShell creates or updates its tray icon, then the existing icon path resolves to the matching bundled ICO instead of an empty native image.
- Given a future release payload lacks either tray ICO, when `npm run release:dry-run` validates it, then the command fails clearly before a ZIP is reported as prepared.
- Given unrelated assets are not runtime dependencies, when Forge packages the app, then they remain excluded from the ASAR.

## Spec Change Log

## Design Notes

The source lookup intentionally uses a single relative path that works from `.vite/build` in development. Keeping the tray subset in `app.asar` maintains that contract for releases. `extraResource` would place files under `process.resourcesPath`, so it would require a second runtime path branch and creates a larger surface than the package-filter correction.

## Verification

**Commands:**
- `npx vitest run forge.config.test.ts scripts/npm/package-release.test.js src/main/tray-manager.test.ts` -- expected: package filter, release payload, and existing theme-selection tests pass.
- `npm run package` -- expected: a Windows package is created under `out/quakeshell-win32-x64` with no Forge packaging error.
- `npm run release:dry-run` -- expected: the release validation accepts the packaged icons and prepares the local ZIP/checksum artifact.

**Manual checks:**
- Launch `out/quakeshell-win32-x64/quakeshell.exe` after `npm run package`; confirm a visible tray glyph under the current Windows theme, change the system theme or trigger the existing theme-update path, and confirm the glyph remains visible.
- Inspect `out/quakeshell-win32-x64/resources/app.asar` with `@electron/asar` if the package test needs diagnosis; both `assets/tray/icon-dark.ico` and `assets/tray/icon-light.ico` must be listed.