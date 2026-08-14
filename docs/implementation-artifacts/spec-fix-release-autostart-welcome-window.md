---
title: 'Prevent the development Electron runtime from launching at Windows login'
type: 'bugfix'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: '60bc5a73476e0b61b38908a32d153a66e0b7e64a'
context:
  - 'docs/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An unpackaged QuakeShell development run applies the default `autostart: true` configuration through Electron. Because its executable is `node_modules/electron/dist/electron.exe`, Windows receives an `electron.app.Electron` Run entry that launches Electron's stock `default_app.asar` at the next login. The packaged QuakeShell archive and its own `electron.app.quakeshell` entry are valid; the unwanted random window is the stale development Electron registration.

**Approach:** Restrict login-item registration to packaged application runs. When the app is unpackaged, use Electron's login-item API to disable the matching development registration, which both prevents future Electron default-app launches and removes the stale entry created by prior development runs.

## Boundaries & Constraints

**Always:** Preserve packaged QuakeShell autostart behavior, including the configured `autostart` value, its `electron.app.quakeshell` login item, tray-resident startup, and config hot reload. In development, no configuration value may create or retain an Electron runtime login item. Use Electron's supported login-item API rather than writing or deleting registry values directly.

**Ask First:** Changing the default autostart setting for packaged releases, modifying the installer or release archive, changing Windows login-item names, or removing startup entries not owned by the current QuakeShell development runtime.

**Never:** Change first-run onboarding, window visibility, `--cwd` handling, tray behavior, PTY startup, or Squirrel packaging. Do not remove arbitrary Electron or third-party startup entries as a broad registry cleanup.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Unpackaged launch | Development Electron runtime, `autostart: true` or `false` | No login item is enabled; Electron removes the matching `electron.app.Electron` registration created by previous development runs | Log that unpackaged autostart is disabled; app otherwise starts normally |
| Packaged release launch | Packaged QuakeShell app, `autostart: true` | Existing QuakeShell login-item registration remains enabled and launches the packaged executable | Existing Electron login-item handling remains unchanged |
| Packaged autostart disabled | Packaged QuakeShell app, `autostart: false` | Matching QuakeShell login-item registration is removed | Existing config listener applies the change |
| Live development config update | Unpackaged app changes `autostart` | No Electron runtime login item is re-enabled | Existing hot-reload path remains functional |
| Other startup entries | Entries unrelated to the current development Electron executable | Remain untouched | No raw registry sweep is performed |

</frozen-after-approval>

## Code Map

- `src/main/app-lifecycle.ts` -- owns `applyAutostart()` and is called during initial startup and config changes; add the packaged-runtime guard and development-entry cleanup here.
- `src/main/app-lifecycle.test.ts` -- mocks Electron's login API; add coverage for packaged registration, unpackaged cleanup, and settings hot-reload behavior.
- `src/main/index.ts` -- read-only caller that applies configured autostart during startup; no change is expected once `applyAutostart()` owns the runtime distinction.
- `src/main/ipc-handlers.ts` -- read-only secondary caller for live `autostart` changes; it must continue delegating to the shared lifecycle function.
- `src/shared/config-schema.ts` -- read-only evidence that `autostart` defaults to `true`; retain the existing packaged-user default.
- `node_modules/electron/dist/resources/default_app.asar` -- local diagnostic evidence that bare `electron.exe` launches Electron's stock app; not a source artifact to modify.

## Tasks & Acceptance

**Execution:**
- [x] `src/main/app-lifecycle.ts` -- make `applyAutostart()` branch on Electron's packaged-runtime state. Preserve the existing configured login-item call when packaged; when unpackaged, explicitly disable the matching default Electron login item so an existing `electron.app.Electron` Run entry is removed instead of refreshed.
- [x] `src/main/app-lifecycle.test.ts` -- make the Electron packaged-state mock controllable and cover enabled/disabled packaged registration, unpackaged cleanup regardless of config value, and the existing live config listener path.

**Acceptance Criteria:**
- Given QuakeShell runs with Electron unpackaged and `autostart` is either enabled or disabled in configuration, when startup or live config handling applies autostart, then Electron receives only a disable request for the current development login item and no `electron.app.Electron` entry remains to start `electron.exe` at login.
- Given QuakeShell runs as a packaged application with `autostart: true`, when startup applies autostart, then it retains the existing enabled QuakeShell login-item registration.
- Given QuakeShell runs as a packaged application with `autostart: false`, when startup or live config handling applies autostart, then it removes the matching QuakeShell login-item registration.
- Given a Windows account has unrelated startup entries, when QuakeShell runs unpackaged, then no direct registry operation changes those entries.

## Spec Change Log

## Design Notes

The persistent problem is not a release-window visibility bug: the registry shows a second, generic Electron login command that points at the repository's development runtime. Electron defaults a login item's target to `process.execPath`, so unconditional autostart registration makes a development run persist that bare runtime. `app.isPackaged` is the narrow ownership boundary: release behavior remains unchanged, while an unpackaged run disables the entry created for its own executable through Electron's API rather than guessing at or sweeping registry values.

## Verification

**Commands:**
- `npx vitest run src/main/app-lifecycle.test.ts` -- expected: all lifecycle, autostart, CWD, and second-instance regression tests pass.
- `npx eslint src/main/index.ts src/main/app-lifecycle.ts src/main/app-lifecycle.test.ts` -- expected: no lint errors in the changed startup path.

**Manual checks (if no CLI):**
- Run the unpackaged app once, then verify `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` no longer contains `electron.app.Electron` pointing to this repository's `node_modules\electron\dist\electron.exe`. Verify `electron.app.quakeshell` continues to point at the packaged QuakeShell executable when release autostart is enabled, then restart or sign in and confirm Electron's default window no longer appears.

## Suggested Review Order

**Runtime Boundary**

- Gate development cleanup by runtime packaging while preserving release configuration.
  [`app-lifecycle.ts:231`](../../src/main/app-lifecycle.ts#L231)

**Regression Coverage**

- Make Electron packaging state controllable for each branch.
  [`app-lifecycle.test.ts:12`](../../src/main/app-lifecycle.test.ts#L12)

- Preserve configured login-item behavior for packaged releases.
  [`app-lifecycle.test.ts:318`](../../src/main/app-lifecycle.test.ts#L318)

- Assert unpackaged startup only requests development-entry cleanup.
  [`app-lifecycle.test.ts:340`](../../src/main/app-lifecycle.test.ts#L340)

- Exercise cleanup through the live autostart configuration path.
  [`app-lifecycle.test.ts:381`](../../src/main/app-lifecycle.test.ts#L381)