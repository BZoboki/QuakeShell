---
title: 'Fix packaged tray quit destroyed-window error'
type: 'bugfix'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fa07f0574fd2720d7afed32fed7630d63c62d437'
context:
  - 'docs/implementation-artifacts/spec-quakeshell-npm-wrapper.md'
  - 'docs/implementation-artifacts/spec-silent-background-update-restart-prompt.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** In the packaged Windows app provisioned by the global npm wrapper, choosing Quit from the tray can display a main-process `TypeError: Object has been destroyed`. The current user configuration enables focus fade, whose delayed blur callback can call `hide()` after graceful shutdown has closed the native window.

**Approach:** Make graceful shutdown cancel focus-fade work before closing the main window, and make the window hiding path harmless when a stale asynchronous callback reaches an already-destroyed window. Preserve the current tray Quit flow and the update-restart flow that reuses the same shutdown function.

## Boundaries & Constraints

**Always:** Keep the existing shutdown ordering for PTY cleanup, quitting state, main-window close, tray destruction, and `app.quit()`. Cancel only lifecycle-owned focus-fade work before native window teardown. Retain normal focus-fade behavior for a live window. Cover the npm-packaged tray scenario through main-process unit tests without requiring a real global installation during CI.

**Ask First:** Changing user-visible focus-fade timing or configuration semantics; changing npm release packaging, the launcher, or the forced-quit timeout policy.

**Never:** Suppress errors globally, swallow unrelated Electron failures, add a new shutdown architecture, modify user configuration, or change tray menu labels and commands.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Tray quit with focus fade pending | Visible main window has received `blur`; its 300 ms focus-fade timer is active; user selects tray Quit | Graceful shutdown removes the focus-fade listener and clears the pending timer before closing the window; no delayed hide executes after teardown | Existing PTY, tray, and app-quit error handling remains unchanged |
| Stale fade callback | A delayed focus-fade callback fires after its `BrowserWindow` has been destroyed | `hide()` returns before calling Electron window methods such as `getBounds()` | No uncaught main-process error is emitted |
| Ordinary focus fade | A visible, live window loses focus outside shutdown | The existing grace period and hide behavior remain intact | Existing cancellation on refocus, settings opening, and manual hide remains intact |

</frozen-after-approval>

## Code Map

- `src/main/app-lifecycle.ts` -- `gracefulShutdown()` owns the tray Quit and update-restart shutdown sequence; set the quitting flag, then tear down focus fade before closing the main window.
- `src/main/window-manager.ts` -- `setupFocusFade()` owns the delayed blur callback, `teardownFocusFade()` clears it, and `hide()` must reuse `isWindowUnavailable()` before touching a native `BrowserWindow`.
- `src/main/app-lifecycle.test.ts` -- lifecycle mocks and ordering assertions cover shutdown cleanup before native window close.
- `src/main/window-manager.test.ts` -- fake-timer focus-fade tests can simulate blur, native destruction, and the absence of native method calls from a stale callback.
- `src/main/index.ts` -- read-only integration evidence: tray `onQuit` and update restart both delegate to `gracefulShutdown()`.
- `docs/implementation-artifacts/spec-quakeshell-npm-wrapper.md` -- read-only distribution contract for the packaged executable reached by the npm launcher.
- `docs/implementation-artifacts/spec-silent-background-update-restart-prompt.md` -- read-only constraint that explicit restart continues to use graceful shutdown.

## Tasks & Acceptance

**Execution:**
- [x] `src/main/app-lifecycle.ts` -- invoke focus-fade teardown during `gracefulShutdown()` after setting the quitting state and before closing the main window -- cancels the timer and listeners while the native window is still valid.
- [x] `src/main/window-manager.ts` -- make `hide()` no-op when the current window is unavailable, using the existing availability helper -- prevents any stale asynchronous caller from invoking native methods on a destroyed window.
- [x] `src/main/app-lifecycle.test.ts` -- extend the window-manager mock and shutdown-order regression test -- proves focus-fade teardown precedes native window close without changing the established cleanup order.
- [x] `src/main/window-manager.test.ts` -- add a fake-timer regression that schedules focus fade, marks the window destroyed before expiry, and verifies the callback does not call native window methods -- protects the packaged tray-quit failure mode while preserving live-window behavior.

**Acceptance Criteria:**
- Given a packaged npm-installed QuakeShell instance with focus fade enabled, when a tray Quit occurs during or immediately after a blur, then the app exits without an uncaught `Object has been destroyed` main-process error.
- Given a restart is initiated through the existing update prompt, when graceful shutdown runs, then it receives the same focus-fade cleanup protection and continues the existing restart flow.
- Given focus fade is enabled and the main window remains live, when it loses focus, then its existing delayed hide behavior still works.
- Given no focus-fade timer is active, when tray Quit occurs, then the established PTY cleanup, tray destruction, and application quit behavior remains unchanged.

## Spec Change Log

## Design Notes

The cancellation and the guard solve distinct timing boundaries. Shutdown-side cancellation prevents the known tray interaction from leaving a delayed callback behind. The `hide()` guard protects the owning window operation against any future delayed or fire-and-forget caller that races native teardown, without changing normal focus-fade behavior.

## Verification

**Commands:**
- `npx vitest run src/main/app-lifecycle.test.ts src/main/window-manager.test.ts src/main/notification-manager.test.ts` -- expected: lifecycle, stale focus-fade, and shared update-restart coverage pass.
- `npx eslint src/main/app-lifecycle.ts src/main/window-manager.ts src/main/app-lifecycle.test.ts src/main/window-manager.test.ts` -- expected: touched main-process source and tests pass linting.
- `npm run package` -- expected: Forge produces the Windows package without a TypeScript or packaging regression.

## Suggested Review Order

**Shutdown sequencing**

- Stops shared shutdown from leaving focus-fade work behind.
  [app-lifecycle.ts:309](../../src/main/app-lifecycle.ts#L309)

**Window-lifetime safety**

- Stops an animation interval before it accesses a destroyed native window.
  [window-manager.ts:382](../../src/main/window-manager.ts#L382)

- Rechecks the captured window after asynchronous animation before final native calls.
  [window-manager.ts:497](../../src/main/window-manager.ts#L497)

**Regression coverage**

- Proves teardown precedes close and still runs for a destroyed window.
  [app-lifecycle.test.ts:484](../../src/main/app-lifecycle.test.ts#L484)

- Exercises both pending and in-flight callbacks after native destruction.
  [window-manager.test.ts:727](../../src/main/window-manager.test.ts#L727)

- Restores live blur-to-hide coverage with an accurate window fixture.
  [opacity-focus-fade.integration.test.ts:40](../../src/main/opacity-focus-fade.integration.test.ts#L40)