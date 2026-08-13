---
title: 'Fix scrollback loss when a split pane resizes (missing windowsPty option)'
type: 'bugfix'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '2f6fcdffd7e4a2b0a779cf66c58e5a5be4f6d6ed'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After the split-view remount fix, a *different* bug remains: any pane whose column count changes (a pane shrinking when a second tab links into it, or widening back when disconnected) permanently loses its scrollback, confirmed live — Shift+PageUp fails too (not just mouse wheel), and resizing the window afterward does not restore it (content is actually corrupted, not just a stale display). Root cause: `node-pty` spawns with `useConpty: true` (`src/main/terminal-manager.ts:429,547`), but `TerminalView.tsx` constructs every xterm.js `Terminal` without the `windowsPty` option. xterm.js's internal `_isReflowEnabled` getter uses `windowsPty.buildNumber` to select the correct ConPTY-aware reflow strategy on column-count resize; without it, xterm falls back to generic reflow logic that doesn't match ConPTY's line-wrap semantics and corrupts the buffer.

**Approach:** Compute the real Windows build number in the main process (reusing the exact `os.release()` parsing already used for `PLATFORM_IS_ACRYLIC_SUPPORTED` in `src/main/ipc-handlers.ts:478-481`), expose it to the renderer via a new IPC channel + preload method, fetch it once at app boot, and pass `windowsPty: { backend: 'conpty', buildNumber }` into every `Terminal` construction in `TerminalView.tsx` — Windows only.

## Boundaries & Constraints

**Always:** Only affects Windows (`process.platform === 'win32'`); macOS/Linux must construct `Terminal` exactly as before (no `windowsPty`). Keep `useConpty: true` in `terminal-manager.ts` unchanged. Fetch the build number once at boot, not per-resize or per-tab.

**Ask First:** None — the fix is deterministic and the existing acrylic-support handler is a direct, proven precedent for the exact computation needed.

**Never:** Do not use `windowsMode` (a cruder option that disables reflow entirely, losing correct rewrap behavior) as the fix. Do not touch `SplitPane.tsx`/`App.tsx`'s render-unification logic from the prior split-view-scrolling fix — that fix is confirmed correct and unrelated to this bug.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Windows, link two tabs | Tab with scrollback shrinks from 100% to 50% width | Scrollback stays intact and scrollable (wheel + Shift+PageUp) after the resize | N/A |
| Windows, disconnect | Remaining tab widens from 50% back to 100% | Scrollback stays intact and scrollable after the resize | N/A |
| macOS/Linux | Any pane resize | Behavior unchanged from before this fix (no `windowsPty` set) | N/A |
| Build-number query fails | Main process IPC handler throws | Renderer falls back to constructing `Terminal` without `windowsPty` (today's behavior) rather than crashing | Catch and log; do not block terminal creation |

</frozen-after-approval>

## Code Map

- `src/main/terminal-manager.ts:429,547` -- `useConpty: true`; confirms ConPTY backend, not modified.
- `src/main/ipc-handlers.ts:478-481` -- existing `PLATFORM_IS_ACRYLIC_SUPPORTED` handler; exact `os.release()` build-number parsing pattern (`Number.parseInt(os.release().split('.')[2] ?? '0', 10)`) to reuse for the new handler.
- `src/shared/channels.ts` -- add new channel constant (e.g. `PLATFORM_GET_TERMINAL_PTY_INFO`), following existing `PLATFORM_IS_ACRYLIC_SUPPORTED` naming.
- `src/preload/index.ts:188-190` -- `platform` namespace; add a new method mirroring `isAcrylicSupported()`'s exact pattern.
- `src/renderer/components/App.tsx:215-234` -- init effect that already awaits `initConfigStore()`/`initThemeStore()` before first render; add the new fetch-once-at-boot call alongside them.
- `src/renderer/components/Terminal/TerminalView.tsx:65-75` -- the `new Terminal({...})` call; add `windowsPty` conditionally (Windows only) using the cached value.
- `node_modules/@xterm/xterm/lib/xterm.js` (read-only evidence) -- `_isReflowEnabled` getter; proves the exact mechanism being fixed.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/channels.ts` -- Add `PLATFORM_GET_TERMINAL_PTY_INFO` channel constant. -- New IPC contract for the build-number query.
- [x] `src/main/ipc-handlers.ts` -- Add an `ipcMain.handle` for the new channel returning `{ backend: 'conpty', buildNumber } | null` (null on non-Windows), reusing the existing `os.release()` parsing. -- Provides the real Windows build number to the renderer.
- [x] `src/preload/index.ts` -- Add `platform.getTerminalPtyInfo()` invoking the new channel. -- Renderer-accessible bridge, matching existing `platform.isAcrylicSupported()` convention.
- [x] `src/renderer/state/` (new small module, e.g. `platform-store.ts`) -- Fetch-once cache for the pty info, populated by an `init*` function. -- Avoids refetching per-tab/per-resize.
- [x] `src/renderer/components/App.tsx` -- Call the new init function alongside `initConfigStore()`/`initThemeStore()` in the boot effect, before any tab/terminal renders. -- Guarantees the cached value is ready before the first `Terminal` is constructed.
- [x] `src/renderer/components/Terminal/TerminalView.tsx` -- Pass `windowsPty: { backend: 'conpty', buildNumber }` into `new Terminal({...})` when the cached value is present; omit the key entirely otherwise. -- Applies the actual xterm.js fix.

**Acceptance Criteria:**
- Given Windows with ConPTY, when a pane with scrollback is resized to a different column count (link or disconnect), then its scrollback remains intact and scrollable (mouse wheel and Shift+PageUp) afterward.
- Given macOS/Linux, when any pane resizes, then `Terminal` construction is unchanged from before this fix.
- Given the build-number IPC call fails, then `TerminalView` still constructs a working `Terminal` without `windowsPty` rather than throwing.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including new tests for the IPC handler, preload method, and `TerminalView`'s conditional `windowsPty` construction.
- `npm run lint` -- expected: no new lint errors.

**Manual checks (if no CLI):**
- On Windows: open a tab, generate >1 screen of output, link it with a second tab, confirm the first pane still scrolls (wheel and Shift+PageUp) after the width change. Disconnect and confirm scrollback is still intact and scrollable on the remaining tab.

## Suggested Review Order

**Root-cause fix — applying the xterm.js option**

- Entry point: this is the actual fix — everything else in the diff exists only to compute and deliver this value.
  [`TerminalView.tsx:71`](../../src/renderer/components/Terminal/TerminalView.tsx#L71)

- The conditional spread that omits `windowsPty` entirely on macOS/Linux or when the cache is empty.
  [`TerminalView.tsx:83`](../../src/renderer/components/Terminal/TerminalView.tsx#L83)

**Data source — computing the real Windows build number**

- Reuses the exact `os.release()` parsing already proven by `PLATFORM_IS_ACRYLIC_SUPPORTED`, with an explicit NaN guard added after review.
  [`ipc-handlers.ts:483`](../../src/main/ipc-handlers.ts#L483)

**Boot-time delivery — fetch once, cache, gate on it before first render**

- Fetch-once cache; deliberately a plain variable, not a signal, since the value never changes after boot.
  [`platform-store.ts:13`](../../src/renderer/state/platform-store.ts#L13)

- Wired into the same `Promise.all` that already gates config/theme init before the first tab renders.
  [`App.tsx:231`](../../src/renderer/components/App.tsx#L231)

**Plumbing — IPC contract**

- New channel constant, preload bridge, and shared type — each mirrors an existing sibling exactly.
  [`channels.ts:63`](../../src/shared/channels.ts#L63)
  [`preload/index.ts:190`](../../src/preload/index.ts#L190)
  [`ipc-types.ts:220`](../../src/shared/ipc-types.ts#L220)

**Regression coverage**

- Both `windowsPty`-present and `windowsPty`-omitted branches asserted against the real `Terminal` constructor call.
  [`TerminalView.test.tsx:304`](../../src/renderer/components/Terminal/TerminalView.test.tsx#L304)

- All main-process branches (Windows, non-Windows, malformed release string) including the post-review NaN case.
  [`ipc-handlers.test.ts:487`](../../src/main/ipc-handlers.test.ts#L487)

- Guards that boot-time init is actually invoked before rendering proceeds.
  [`App.test.tsx:176`](../../src/renderer/components/App.test.tsx#L176)
