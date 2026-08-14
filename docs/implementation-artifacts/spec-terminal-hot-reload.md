---
title: 'Add terminal environment hot reload'
type: 'feature'
created: '2026-08-14'
status: 'done'
baseline_commit: 'ed0f1e8951f0dfb3ceba921e832211155dcdb4ca'
review_loop_iteration: 0
context:
  - 'docs/planning-artifacts/architecture-v2.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PTYs keep their original environment. After an installer adds a command directory to Windows `PATH`, such as npm, users must manually close and recreate terminal tabs before it is available.

**Approach:** Add an explicit reload action that replaces running PTYs with fresh, shell-appropriate child environments while preserving tab structure. It warns that running processes and in-shell state end.

## Boundaries & Constraints

**Always:** Require explicit action; invalidate cached registry `PATH`; reload only running live PTYs; preserve tab ID, metadata, order, selection, split layout, recorded launch directory, and dimensions; create a replacement before killing its current PTY; retain the original on failure; emit a dedicated success event; prevent overlap; and apply the shell matrix below.

**Ask First:** Automatic reload; persistent setting, tray action, or shortcut; dynamic-directory/process/scrollback restoration; translating Windows `PATH` into a Linux distro `PATH`; WSL configuration changes; or broader environment discovery.

**Never:** Treat reload as a normal exit; close/reorder/recreate tabs; replace pending or exited tabs; expose arbitrary process execution; or restart Electron.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Successful reload | User activates reload on running tabs | Fresh environment; stable tab metadata/layout; matching xterm buffers reset | Return reloaded IDs |
| Shell-specific reload | Windows aliases, WSL, or custom path | Use the shell matrix below | Leave original PTY attached and report a failed replacement |
| No eligible tabs | Tabs are pending or exited | No PTY changes | Return an empty result |
| Late exit or repeated request | Old PTY callback arrives, or reload is in progress | Replacement remains running; no duplicate PTYs | Ignore stale callbacks; reject/disable repeat |

</frozen-after-approval>

## Code Map

- `src/main/terminal-manager.ts` -- invalidate `resolvedRegistryPath`; build shell-aware launch inputs while retaining WSL variables and custom-path validation.
- `src/main/tab-manager.ts` -- replace eligible `TabSession` PTYs in place, retain dimensions, guard callbacks, and return partial failures.
- `src/main/ipc-handlers.ts`, `src/shared/channels.ts`, `src/shared/ipc-types.ts`, and `src/preload/index.ts` -- typed reload invoke/event bridge; not legacy `terminal:respawn`.
- `src/renderer/components/Terminal/TerminalView.tsx` and `src/renderer/components/Settings/GeneralSettings.tsx` -- reset successful xterm instances and expose the warned, in-flight action.
- Existing co-located main, shared, preload, renderer terminal, and General settings tests -- focused regression coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/main/terminal-manager.ts` and tests -- invalidate `PATH` cache; test absolute system shells, fresh-path `pwsh`/Git Bash resolution, WSL variables, and custom paths.
- [x] `src/main/tab-manager.ts` and tests -- in-place replacement with dimensions, callback guards, serialized requests, and partial failures.
- [x] IPC/shared/preload files and tests -- typed reload invoke/event bridge.
- [x] `TerminalView`, `GeneralSettings`, CSS, and tests -- targeted xterm reset plus warned, in-flight action and feedback.

**Acceptance Criteria:**
- Given Windows `PATH` changes after startup, when reload succeeds, then commands in replacement Windows-shell tabs resolve without restarting QuakeShell.
- Given PowerShell, PowerShell Core, cmd, Git Bash, WSL, or custom tabs, when reload succeeds, then each follows its shell-specific launch contract below.
- Given running/split tabs, when reload succeeds, then IDs, order, selection, shell, launch directory, color, name, and layout remain stable while buffers reset.
- Given replacement failure, pending/exited tabs, stale callbacks, or a concurrent request, then originals remain usable where applicable, ineligible tabs stay untouched, false exit UI never appears, and duplicate reloads do not start.

## Spec Change Log

## Design Notes

Reload replaces a process rather than mutating it. Create a candidate before stopping the original, guard late `node-pty` callbacks by identity, and preserve only the recorded launch directory, not interactive `cd` state.

| Session | Reload contract |
|---------|-----------------|
| `powershell`, `cmd` | Existing absolute Windows executable + fresh normalized Windows child environment. |
| `pwsh`, `bash` | Resolve from refreshed Windows path before node-pty starts them; relative commands resolve before the child environment applies. |
| `wsl` | Replace `wsl.exe`, retain `TERM`/`COLORTERM`, and leave command discovery to distro startup rules. |
| Custom path | Preserve the configured path and validation; do not infer its shell family. |

## Verification

**Commands:**
- `npx vitest run src/main/terminal-manager.test.ts src/main/tab-manager.test.ts src/main/ipc-handlers.test.ts src/preload/index.test.ts src/shared/shared.test.ts src/renderer/components/Terminal/TerminalView.test.tsx src/renderer/components/Settings/GeneralSettings.test.tsx` -- expected: focused tests pass.
- `npm test` -- expected: full suite passes.

**Manual checks (if no CLI):**
- Reload each supported shell after adding a Windows `PATH` test command; verify Windows shells resolve it, WSL follows distro startup, and invalid custom replacement leaves its original usable.

## Suggested Review Order

**In-Place Replacement**

- Candidates replace only live sessions and roll back when original teardown fails.
  [`tab-manager.ts:279`](../../src/main/tab-manager.ts#L279)

- PTY-identity guards discard old-process output and exit events.
  [`tab-manager.ts:81`](../../src/main/tab-manager.ts#L81)

**Fresh Shell Environment**

- Registry `PATH` is cleared before each replacement pass.
  [`terminal-manager.ts:265`](../../src/main/terminal-manager.ts#L265)

- Shell paths honor inbox, PATH-discovered, WSL, and custom launch contracts.
  [`terminal-manager.ts:127`](../../src/main/terminal-manager.ts#L127)

- Child environments are built before node-pty resolves its executable.
  [`terminal-manager.ts:574`](../../src/main/terminal-manager.ts#L574)

**Process Boundary And UX**

- IPC routes the request to the tab owner, not the legacy singleton.
  [`ipc-handlers.ts:321`](../../src/main/ipc-handlers.ts#L321)

- Preload maintains typed invoke and dedicated success-notification boundaries.
  [`index.ts:130`](../../src/preload/index.ts#L130)

- Only successful replacements reset xterm buffers and retain input readiness.
  [`TerminalView.tsx:250`](../../src/renderer/components/Terminal/TerminalView.tsx#L250)

- Confirmation, in-flight state, and feedback make the destructive action explicit.
  [`GeneralSettings.tsx:165`](../../src/renderer/components/Settings/GeneralSettings.tsx#L165)

**Contract And Verification**

- Shared result types and channels make reload outcomes explicit across processes.
  [`ipc-types.ts:130`](../../src/shared/ipc-types.ts#L130)

- Cache-refresh regression proves a fresh registry read selects a new executable.
  [`terminal-manager.test.ts:679`](../../src/main/terminal-manager.test.ts#L679)

- Lifecycle regression proves partial reloads, rollback, and stale-event suppression.
  [`tab-manager.test.ts:353`](../../src/main/tab-manager.test.ts#L353)

- Settings regressions prove partial, no-op, and rejected-request feedback.
  [`GeneralSettings.test.tsx:164`](../../src/renderer/components/Settings/GeneralSettings.test.tsx#L164)