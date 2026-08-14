---
title: 'Visible Update Management and About Information'
type: 'feature'
created: '2026-08-14'
status: 'done'
baseline_commit: 'fa07f0574fd2720d7afed32fed7630d63c62d437'
review_loop_iteration: 0
context:
  - 'docs/implementation-artifacts/spec-silent-background-update-restart-prompt.md'
  - 'docs/implementation-artifacts/3-6-windows-notifications-and-update-checking.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tray's manual update action gives no visible lifecycle while a check or supported install runs, and its About dialog only presents a version. The in-app Settings UI also cannot show the installed version, check for an update, start one intentionally, or report update progress.

**Approach:** Establish one main-process update-operation state that drives native tray labels, a dedicated Updates settings tab, and richer About content. Keep background scheduled updates non-interrupting, while a user-initiated check lets the user inspect availability and deliberately start the supported update path.

## Boundaries & Constraints

**Always:** Keep npm registry versions validated before use; preserve argument-array spawning and Windows npm-install eligibility checks; never interrupt an active terminal or restart without explicit consent; expose honest phase-level status (`checking`, `available`, `installing`, `ready-to-restart`, `up-to-date`, or `error`) rather than synthetic byte percentages; keep periodic no-update and offline failures quiet; reuse the existing pending-update/restart flow.

**Ask First:** Changing package sources, automatic-update eligibility, the scheduled background-install policy, or adding telemetry/network activity beyond the existing npm-registry check and release-page fallback.

**Never:** Never run a registry-derived value through a shell command string, make the renderer decide whether an install is supported, add a new update dependency, auto-restart, or replace the existing restart prompt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Manual check | User selects Check for Updates in the tray or Updates settings tab | Shared status becomes checking, then shows up-to-date or the available version; tray menu and settings reflect the same state | The initiating control is disabled until the check resolves |
| Supported install | A manual check finds a newer version on an npm-managed Windows install and user selects Install Update | Status becomes installing, then ready-to-restart after npm succeeds; existing restart prompt and explicit restart action remain available | Failure becomes a visible error with a retry path and preserves the running session |
| Unsupported install | A manual check finds a version on an unsupported distribution | Settings/tray offer an explicit download action for the validated release page instead of claiming installation progress | Opening the release page failure is logged and state remains actionable |
| Check failure | A user-initiated registry request times out, fails, or returns invalid data | Settings shows a readable error; tray state and a user-facing native notification make the failed action visible | Scheduled checks retain their current silent/offline behavior |
| About | User selects About QuakeShell | Dialog shows app purpose, installed version, current update state, and actions to open Updates or the project page | Dialog remains usable when no update status has been fetched yet |

</frozen-after-approval>

## Code Map

- `src/main/notification-manager.ts` -- current owner of registry checks, safe npm spawning, install de-duplication, pending-restart state, and release-page fallback; add the single serializable operation state and its listeners here.
- `src/main/tray-manager.ts` -- native menu currently fire-and-forgets `checkForUpdates(true)` and shows a version-only message box; rebuild menu from operation-state changes and improve the About action.
- `src/main/ipc-handlers.ts` -- already registers pending-update IPC and safely broadcasts state to the renderer; register version/update-operation invokes and update-state broadcast alongside that path.
- `src/shared/channels.ts` and `src/shared/ipc-types.ts` -- central typed IPC registry and `window.quakeshell.app` contract; `APP_GET_VERSION` exists but is currently unwired.
- `src/preload/index.ts` -- expose the constrained update/version bridge and listener without leaking Electron APIs.
- `src/renderer/components/Settings/SettingsTabs.ts` and `src/renderer/components/Settings/SettingsPanel.tsx` -- existing settings routing; add an Updates tab and mount its focused content component.
- `src/renderer/components/Settings/DistributionSettings.tsx` -- established async status, in-flight control, and inline-error pattern to mirror without coupling update state to context-menu registration.
- `src/renderer/components/UpdateRestartPrompt.tsx` and `src/renderer/state/update-store.ts` -- existing completion-only restart experience; consume the new operation state without regressing delayed restart behavior.
- `src/main/notification-manager.test.ts`, `src/main/tray-manager.test.ts`, `src/main/ipc-handlers.test.ts`, `src/shared/shared.test.ts`, and settings/preload tests -- focused regression surfaces for lifecycle, native menu, contract, and UI assertions.

## Tasks & Acceptance

**Execution:**
- [x] `src/main/notification-manager.ts` -- model and publish a single serializable update-operation state; separate manual discovery from explicit supported installation while preserving periodic silent install behavior and current safe fallbacks.
- [x] `src/main/tray-manager.ts` and its test -- subscribe to operation changes, rebuild/disable contextual actions with readable phase labels, offer install/download/restart actions where valid, and replace the version-only About detail with useful product/version/status information and update/project actions.
- [x] `src/shared/channels.ts`, `src/shared/ipc-types.ts`, `src/preload/index.ts`, and `src/main/ipc-handlers.ts` -- add a typed, narrowly scoped bridge for current version, current update state, manual checks, starting an eligible update, and state-change notifications.
- [x] `src/renderer/components/Settings/SettingsTabs.ts`, `src/renderer/components/Settings/SettingsPanel.tsx`, and new focused Updates settings component/style/test files -- add an Updates tab showing installed version, latest/availability state, phase-level status, retryable errors, and only the actions valid for the detected distribution.
- [x] `src/renderer/state/update-store.ts`, `src/renderer/components/UpdateRestartPrompt.tsx`, and focused renderer tests -- integrate the new status contract without changing the existing hidden-to-visible restart-prompt timing or explicit-restart guarantee.
- [x] Focused main/shared/preload/tray/settings tests -- cover every I/O matrix scenario, duplicate action suppression, event unsubscription, and preservation of silent scheduled failures.

**Acceptance Criteria:**
- Given a user opens the Updates settings tab, when its initial IPC requests resolve, then it displays the installed QuakeShell version and the current update-operation state without requiring an external editor or tray notification.
- Given a manual update check is in progress, when the user opens the tray menu or views Settings, then both surfaces visibly identify the same phase and prevent duplicate checks or installs.
- Given a newer update is found by a manual check, when the user chooses the valid update action, then a supported install reports installing and ultimately ready-to-restart, while an unsupported install offers the validated release page.
- Given the updated version is ready, when the user chooses Restart now from the existing prompt or a valid update control, then the existing safe relaunch path is used and no restart occurs without that choice.
- Given a manual check fails, when the failure resolves, then Settings shows an actionable error and the tray reports a completed failed action; the terminal remains usable.
- Given a scheduled check finds no update or fails, when it completes, then it preserves the existing quiet behavior.
- Given the user opens About QuakeShell, when the dialog appears, then it contains the app identity, installed version, update status, and useful update/project navigation rather than only a version string.

## Spec Change Log

## Design Notes

The status contract must distinguish intent from execution: a manual check may end at `available`, while a scheduled eligible check can progress directly to `installing`. The renderer and tray are consumers of this main-owned state; neither should infer install eligibility from platform details or duplicate lifecycle transitions.

For native tray UX, progress means durable menu state that can be inspected on the next right-click, backed by completion/error notifications for an action whose menu has closed. For npm installs, expose stable milestones rather than parsing npm output into unreliable percentages.

## Verification

**Commands:**
- `npx vitest run src/main/notification-manager.test.ts src/main/tray-manager.test.ts src/main/ipc-handlers.test.ts src/preload/index.test.ts src/renderer/components/Settings/UpdateSettings.test.tsx src/renderer/components/UpdateRestartPrompt.test.tsx src/shared/shared.test.ts` -- expected: new lifecycle and existing restart behavior pass.
- `npm run lint` -- expected: no TypeScript/ESLint violations in the main, shared, preload, or renderer update surfaces.
- `npm test` -- expected: full regression suite passes.

## Suggested Review Order

**Update Lifecycle and Recovery**

- Main-owned transitions preserve consent, deduplicate work, and protect active installs.
  [notification-manager.ts:537](../../src/main/notification-manager.ts#L537)

- Relaunch fallback becomes an honest, retryable release-download route.
  [notification-manager.ts:273](../../src/main/notification-manager.ts#L273)

**Cross-Window Contract**

- Typed state keeps update actions constrained across the process boundary.
  [ipc-types.ts:83](../../src/shared/ipc-types.ts#L83)

- Broadcasts reach terminal and standalone Settings windows alike.
  [ipc-handlers.ts:94](../../src/main/ipc-handlers.ts#L94)

**Native and Settings Surfaces**

- Tray labels expose state and valid recovery actions at right-click time.
  [tray-manager.ts:54](../../src/main/tray-manager.ts#L54)

- Settings renders progress, retries, Boolean failures, and initial-load recovery.
  [UpdateSettings.tsx:45](../../src/renderer/components/Settings/UpdateSettings.tsx#L45)

- Store merges snapshots, IPC events, and ready-to-restart state.
  [update-store.ts:79](../../src/renderer/state/update-store.ts#L79)

**Regression Evidence**

- Focused regressions cover manual and scheduled failure plus overlapping lifecycle work.
  [notification-manager.test.ts:423](../../src/main/notification-manager.test.ts#L423)