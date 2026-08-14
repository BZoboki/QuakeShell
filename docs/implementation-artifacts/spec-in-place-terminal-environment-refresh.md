---
title: 'Refresh active terminal environment in place'
type: 'feature'
created: '2026-08-14'
status: 'done'
baseline_commit: 'ed0f1e8951f0dfb3ceba921e832211155dcdb4ca'
review_loop_iteration: 0
context:
  - 'docs/planning-artifacts/architecture.md'
  - 'docs/planning-artifacts/ux-design-specification.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The existing terminal reload replaces PTYs and resets xterm, losing scrollback, shell state, and running work. The user needs a command-like refresh that makes Windows tools newly added to `PATH` available without rebuilding the terminal session.

**Approach:** Put an icon-only refresh button directly before the top-right Settings gear. It targets the focused live terminal pane and writes a trusted, shell-specific `PATH` refresh command to that same PTY, so normal shell echo and xterm scrollback remain intact.

## Boundaries & Constraints

**Always:** Target the focused pane in a split, otherwise the active tab; support exact `powershell`, `pwsh`, `cmd`, and Git Bash (`bash`) aliases; generate command text only in the main process from static templates; write the command plus Enter to the existing PTY; refresh from current Windows Machine and User `Path` values; preserve the PTY identity, xterm instance and buffer, tab status, metadata, layout, selection, working directory, shell variables, aliases, and running jobs. The control is disabled for pending/exited, WSL, and custom-shell tabs and explains why in its tooltip. Its visible command echo is the success feedback. The tooltip must say it sends input and should be used at a shell prompt.

**Ask First:** WSL or arbitrary custom-shell refresh behavior; re-exec/login-shell behavior; automatic PATH refresh; refresh keyboard shortcuts; prompt detection; cancellation, Ctrl+C, line clearing, or any strategy that interrupts foreground work.

**Never:** Do not spawn, kill, replace, resize, or reset a PTY/xterm instance; do not emit a process-exit or replacement-success event; do not add a Settings action, confirmation dialog, persistent option, or arbitrary renderer-provided command execution; do not retain the rejected all-tab PTY-replacement implementation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Supported refresh | Focused running PowerShell, pwsh, cmd, or Git Bash pane | One trusted template plus `\r` is written to its existing PTY; normal terminal output/scrollback continues | Main rejects a failed PTY write without lifecycle changes |
| Split target | Focus is in either pane of a linked split | Refresh affects that exact focused pane, never its sibling | N/A |
| Unsupported target | WSL, custom, pending, or exited tab | Button is disabled; no command, PTY, or tab state changes | Tooltip explains unsupported/unavailable state |
| Busy terminal | Unfinished command or foreground program owns stdin | The static bytes behave exactly like typed input; QuakeShell does not interrupt, clear, or infer a prompt | User invokes only at a shell prompt |
| Missing/raced tab | Target closes or exits before invoke | IPC reports failure; renderer re-enables the button | No replacement or reset occurs |

</frozen-after-approval>

## Code Map

- `src/renderer/components/App.tsx` -- Actual rendered tab bar; `focusedTerminalPane` already identifies the correct split-pane target and the Settings gear is the insertion point.
- `src/renderer/components/App.test.tsx` -- Existing inline-gear test and split-focus fixtures; add button placement, target, disabled, and re-enable coverage here rather than the unused standalone `TabBar`.
- `src/main/tab-manager.ts` -- Owns live `TabSession` PTYs; replace destructive `reloadEnvironment()` with a one-tab static-command write that validates running/live state.
- `src/main/terminal-manager.ts` -- Own shell aliases and PTY utilities; replace replacement-only registry-cache/launch-resolution additions with a fixed in-place refresh-template lookup.
- `src/main/ipc-handlers.ts`, `src/shared/channels.ts`, `src/shared/ipc-types.ts`, `src/preload/index.ts` -- Replace all-tab reload invoke/event/result plumbing with a tab-ID-only refresh invoke; no renderer command text crosses IPC.
- `src/renderer/components/Terminal/TerminalView.tsx` -- Remove the reload-success listener and `terminal.reset()` behavior; data continues over existing `TAB_DATA`.
- `src/renderer/components/Settings/GeneralSettings.tsx` and its module/test -- Remove the destructive all-tab row, confirmation, feedback, and styles.
- `docs/implementation-artifacts/spec-terminal-hot-reload.md` -- Historical record of the rejected PTY-replacement design; do not edit its frozen approved intent.

## Tasks & Acceptance

**Execution:**
- [x] `src/main/terminal-manager.ts` and tests -- Add fixed templates for supported aliases and remove replacement-only cached-registry/launch-path behavior. PowerShell/pwsh read and expand Machine/User `Path` in a scoped script block; cmd updates its own `Path` through a static Windows PowerShell/`for /f` command; Git Bash converts fresh Windows paths with `cygpath -p` and prepends them while retaining its POSIX path entries.
- [x] `src/main/tab-manager.ts` and tests -- Replace `reloadEnvironment()` with `refreshEnvironment(tabId)` that validates the exact tab, writes only the main-owned template to its present PTY, and leaves every lifecycle field unchanged.
- [x] `src/shared/channels.ts`, `src/shared/ipc-types.ts`, `src/main/ipc-handlers.ts`, `src/preload/index.ts`, and tests -- Remove replacement event/result contracts; expose a typed `refreshEnvironment(tabId)` invoke accepting no command payload.
- [x] `src/renderer/components/App.tsx` and tests -- Add the disabled-aware refresh icon immediately before the gear; target `focusedTerminalPane`; prevent repeated clicks while invoking; surface failures without resetting a terminal.
- [x] `src/renderer/components/Terminal/TerminalView.tsx`, `src/renderer/components/Settings/GeneralSettings.tsx`, related tests, and CSS -- Delete all behavior unique to PTY replacement.

**Acceptance Criteria:**
- Given a running supported shell with existing scrollback, when its refresh button is pressed at a prompt, then new Windows `PATH` commands become available and all prior terminal output remains scrollable.
- Given a split terminal, when the right or left pane is focused and refreshed, then only that pane receives the command and its sibling is unchanged.
- Given a supported refresh, when observed in main and renderer tests, then no `spawnPty`, `killPty`, `terminal.reset`, `TAB_EXITED`, replacement event, or tab-state mutation occurs.
- Given WSL, custom, pending, or exited tabs, when rendered, then refresh is unavailable and cannot send bytes to the PTY.

## Spec Change Log

## Design Notes

The button is intentionally equivalent to typing a known command into the current shell. QuakeShell cannot reliably know whether a foreground program or partial command currently owns stdin, so it must neither simulate Ctrl+C nor erase input. The user uses it at a shell prompt.

The shell lookup returns `null` for unsupported aliases. Supported templates are constants owned by `terminal-manager`, not renderer strings. The PowerShell family template reads Machine/User values directly through `.NET`; cmd delegates that read to inbox Windows PowerShell before assigning its current `Path`; Git Bash converts the Windows list through its bundled `cygpath` and retains existing POSIX search paths.

## Verification

**Commands:**
- `npx vitest run src/main/terminal-manager.test.ts src/main/tab-manager.test.ts src/main/ipc-handlers.test.ts src/preload/index.test.ts src/shared/shared.test.ts src/renderer/components/App.test.tsx` -- expected: shell matrix, exact live-PTY write, unsupported cases, IPC boundary, and focused-split UI tests pass.
- `npm test` -- expected: full suite passes.
- `git -c core.whitespace=cr-at-eol diff --check` -- expected: no whitespace errors.

**Manual checks (if no CLI):**
- In PowerShell, pwsh, cmd, and Git Bash, generate scrollback, install/add a test command to Windows `PATH`, use the top-right refresh icon at a shell prompt, and verify the command resolves without losing scrollback, cwd, or a split sibling's state.
- In WSL and a custom-shell tab, verify the disabled icon explains that an in-place Windows PATH refresh is unavailable and sends no terminal input.

## Review Outcome

- Resolved the focused-pending-split regression so refresh never falls back to a running sibling.
- Hardened cmd and Git Bash helper resolution against a stale `PATH`; Git Bash now preserves local shell variables, validates conversion, and deduplicates repeated refreshes.
- Added handler-failure and delayed-PTY-data regression coverage.
- Verified exact source-owned templates in Windows PowerShell, pwsh, cmd, and Git Bash after replacing each shell's `PATH` with a sentinel.
- Ran the focused suite (171 tests), full suite (55 files, 749 tests), diagnostics, and whitespace check with no errors.
- Deferred the pre-existing ambiguity of resolving an arbitrary `bash.exe` as Git Bash in [deferred-work.md](deferred-work.md).

## Suggested Review Order

**Live PTY Boundary**

- The entry point writes one trusted command to the existing selected session.
  [tab-manager.ts:277](../../src/main/tab-manager.ts#L277)

- PTY identity guards suppress callbacks from closed or replaced processes.
  [tab-manager.ts:79](../../src/main/tab-manager.ts#L79)

**Shell Command Safety**

- Static templates refresh only supported shell aliases with no renderer-provided command text.
  [terminal-manager.ts:217](../../src/main/terminal-manager.ts#L217)

- The exact alias lookup rejects WSL, custom paths, and casing variants.
  [terminal-manager.ts:232](../../src/main/terminal-manager.ts#L232)

**Focused UI And IPC**

- Focus selection keeps a pending pane unavailable instead of targeting its sibling.
  [App.tsx:510](../../src/renderer/components/App.tsx#L510)

- The icon sits before Settings and invokes the selected tab only.
  [App.tsx:877](../../src/renderer/components/App.tsx#L877)

- IPC and preload carry only a tab identifier across the process boundary.
  [ipc-handlers.ts:322](../../src/main/ipc-handlers.ts#L322)

- The preload bridge exposes the constrained tab-ID-only operation.
  [preload/index.ts:126](../../src/preload/index.ts#L126)

**Verification**

- Template tests pin supported aliases and static helper requirements.
  [terminal-manager.test.ts:437](../../src/main/terminal-manager.test.ts#L437)

- Lifecycle tests prove stale terminal data is ignored after closure.
  [tab-manager.test.ts:210](../../src/main/tab-manager.test.ts#L210)

- Renderer regression coverage pins a pending focused split pane as disabled.
  [App.test.tsx:631](../../src/renderer/components/App.test.tsx#L631)

- IPC failure coverage keeps renderer error feedback observable.
  [ipc-handlers.test.ts:443](../../src/main/ipc-handlers.test.ts#L443)