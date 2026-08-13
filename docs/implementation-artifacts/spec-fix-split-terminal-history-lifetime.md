---
title: 'Preserve every terminal history when tabs enter split view'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'aaa1b2d6fc1b83424e60b0cfb78888a63f671409'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After two or more populated terminals are linked, only the terminal that was active immediately before linking (normally the rightmost) retains its scrollback. Inactive tabs had already lost their renderer-owned xterm.js instances; linking mounts new empty instances for them, so typing produces fresh scrollable output but cannot recover the truncated history, and disconnecting cannot restore it.

**Approach:** Keep exactly one mounted `TerminalView` and xterm.js `Terminal` per running tab until that tab closes. Switching, linking, disconnecting, or opening a shell picker will change pane visibility and layout without changing terminal lifetime; fitting, PTY resizing, and focus will run only for visible panes.

## Boundaries & Constraints

**Always:** Preserve each running tab's xterm instance, live data subscription, and buffer while inactive. Dispose it when the tab closes or the app unmounts. Refit a pane after it becomes visible, never while hidden or zero-sized, and let only the currently focused visible pane respond to app-level focus. Preserve existing single-pane/split dimensions and the ConPTY `windowsPty` option.

**Ask First:** If a persistent renderer per running tab proves incompatible with an existing explicit tab-count or resource limit, stop before replacing it with transcript replay or another lifetime model.

**Never:** Do not add output replay or history storage to the main process, restart PTYs, add wheel handlers, alter tab grouping semantics, use `windowsMode`, or treat PTY resize debouncing as the fix. Do not dispose a terminal merely because another tab or the shell picker is displayed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link populated tabs | Tabs A and B each have distinct long output; B is active; link as `[A, B]` | Both existing terminal instances and complete histories appear; both panes scroll to their earliest retained lines | N/A |
| Extend or disconnect a split | A populated group changes between one, two, and three visible panes | Surviving tabs are never reconstructed or disposed; histories remain intact after each width change | N/A |
| Hidden output | PTY data arrives while its tab is inactive | Its mounted xterm receives the data and shows it when revealed | N/A |
| Pending shell picker | A deferred tab becomes active while running tabs exist | Picker appears without unmounting running terminals; returning reveals their unchanged buffers | N/A |
| Hidden or zero-sized host | Layout observation fires for an inactive pane or dimensions are not measurable | Skip fit, PTY resize, and focus until the pane is visible with valid dimensions | N/A |
| Close tab | User closes a running tab | Only that tab's terminal is disposed and removed; other instances survive | N/A |

</frozen-after-approval>

## Code Map

- `src/renderer/components/App.tsx` -- currently passes only `currentGroupTabIds` into a conditionally rendered `SplitPane`; tab switching and the shell picker therefore unmount every terminal outside the displayed group. Supply the persistent running-tab set separately from the visible group.
- `src/renderer/components/SplitPane/SplitPane.tsx` -- currently creates panes only for visible IDs. Evolve it into the stable terminal host: retain a keyed pane for every running tab, hide inactive panes, and render widths/dividers only for the visible group.
- `src/renderer/components/SplitPane/SplitPane.module.css` -- owns flex participation and overflow; add inactive-pane layout that preserves DOM ownership without participating in the visible split.
- `src/renderer/components/Terminal/TerminalView.tsx` -- owns the xterm buffer and live IPC listener, and disposes both on unmount. Add visibility/focus-aware fit and focus behavior; revert the uncommitted 150 ms PTY resize debounce because it cannot preserve a disposed buffer.
- `src/renderer/components/App.test.tsx` -- its mocked `SplitPane` sees only visible IDs and cannot detect terminal lifetime. Assert separate persistent and visible ID contracts, including picker and close transitions.
- `src/renderer/components/SplitPane/SplitPane.test.tsx` -- mocks `TerminalView` and covers only `[A] -> [A, B]`. Add mount/unmount/identity coverage for switching and the discriminating `[B] -> [A, B]` prepend transition.
- `src/renderer/components/Terminal/TerminalView.test.tsx` -- add visible/hidden fit, resize, data, and focus coverage; remove tests for the failed debounce.
- `src/main/tab-manager.ts` -- read-only evidence: PTYs persist but output is broadcast live with no transcript cache, so a newly mounted renderer cannot recover old history.
- `node_modules/@xterm/xterm/src/common/buffer/Buffer.ts` -- read-only evidence: modern ConPTY metadata and default options both enable reflow on this Windows build; ordinary column reflow does not explain the position-dependent loss.

## Tasks & Acceptance

**Execution:**
- [x] `src/renderer/components/App.tsx`, `src/renderer/components/App.test.tsx` -- keep the terminal host mounted for all running tabs and pass displayed/focused state independently; prove picker, switch, and close behavior.
- [x] `src/renderer/components/SplitPane/SplitPane.tsx`, `src/renderer/components/SplitPane/SplitPane.module.css`, `src/renderer/components/SplitPane/SplitPane.test.tsx` -- retain stable keyed panes for inactive tabs while laying out only the current group; prove constructor and disposal identity across prepend, extend, switch, and disconnect transitions.
- [x] `src/renderer/components/Terminal/TerminalView.tsx`, `src/renderer/components/Terminal/TerminalView.test.tsx` -- gate fit/resize/focus by visibility and measurable size, refit on reveal, continue writing hidden-tab data, and remove the failed debounce attempt.

**Acceptance Criteria:**
- Given two or more running tabs with recognizable earliest output, when any tab is active before they are linked in any order, then every pane retains and can scroll through its complete xterm scrollback.
- Given a running tab, when it is switched away from, hidden by a shell picker, linked, disconnected, or moved between one- and multi-pane layouts, then its terminal instance is not reconstructed or disposed.
- Given inactive panes, when window/container resize or global focus events occur, then they send no invalid PTY resize and do not steal focus from the current visible pane.

## Spec Change Log

- 2026-08-13 review: preserved deferred focus when the active pane is temporarily zero-sized, shared recovery across window and container resize, and added focused-pane, partial-layout, picker, and reveal-resize regressions.

## Design Notes

Terminal lifetime follows the main-process tab session, not current visibility. Keep hidden pane DOM nodes under one stable host so Preact keys preserve component identity; visibility is a prop/state transition. A hidden terminal may continue accepting `TAB_DATA`, but it must retain its last valid geometry until a post-reveal fit obtains non-zero dimensions.

## Verification

**Commands:**
- `npm test -- src/renderer/components/SplitPane/SplitPane.test.tsx src/renderer/components/Terminal/TerminalView.test.tsx src/renderer/components/App.test.tsx` -- expected: lifecycle, hidden-data, fit, resize, focus, and close regressions pass.
- `npm test` -- expected: full suite passes.
- `npm run lint` -- expected: no new lint errors.
- `npm run package` -- expected: main, preload, and renderer production bundles package successfully.

**Automated results (2026-08-13):**
- Focused renderer suites: 65 tests passed across 3 files.
- Full suite: 677 tests passed; 2 unrelated focus-fade tests failed because their BrowserWindow mock lacks `hide()`.
- Suite excluding the independently failing focus-fade file: 673 tests passed across 52 files.
- Scoped ESLint over every changed TypeScript file: passed with no output; editor diagnostics and `git diff --check` also passed.
- Repository-wide ESLint: pre-existing baseline remains red with 25 errors and 80 warnings; no finding targets a changed file.
- Electron package build: passed for main, preload, and renderer targets and produced the Windows x64 package.

**Manual acceptance:**
- Not run in this automated session; requires interaction with the native Electron terminal.
- Create three tabs with numbered output longer than one screen, visit each, make the rightmost active, then link all three. Confirm every pane can scroll to its first numbered line; disconnect and repeat with a different tab active before linking.

## Suggested Review Order

**Persistent Terminal Lifetime**

- Separate persistent renderer ownership from the currently displayed terminal group.
	[`App.tsx:472`](../../src/renderer/components/App.tsx#L472)

- Keep one keyed pane mounted for every non-pending tab.
	[`SplitPane.tsx:34`](../../src/renderer/components/SplitPane/SplitPane.tsx#L34)

- Remove hidden hosts from layout without disposing their terminal DOM.
	[`SplitPane.module.css:9`](../../src/renderer/components/SplitPane/SplitPane.module.css#L9)

**Layout And Focus Safety**

- Reject fit, resize, and focus work until dimensions are measurable.
	[`TerminalView.tsx:112`](../../src/renderer/components/Terminal/TerminalView.tsx#L112)

- Complete deferred focus after either window or container resize.
	[`TerminalView.tsx:123`](../../src/renderer/components/Terminal/TerminalView.tsx#L123)

- Queue app-level focus only for the active visible terminal.
	[`TerminalView.tsx:254`](../../src/renderer/components/Terminal/TerminalView.tsx#L254)

- Refit visibility transitions while preserving the existing xterm instance.
	[`TerminalView.tsx:282`](../../src/renderer/components/Terminal/TerminalView.tsx#L282)

**Regression Evidence**

- Prove the discriminating hidden-left prepend preserves both terminal identities.
	[`SplitPane.test.tsx:270`](../../src/renderer/components/SplitPane/SplitPane.test.tsx#L270)

- Exercise identity across split extension, switching, and disconnecting.
	[`SplitPane.test.tsx:306`](../../src/renderer/components/SplitPane/SplitPane.test.tsx#L306)

- Verify hidden terminals retain live output without layout side effects.
	[`TerminalView.test.tsx:424`](../../src/renderer/components/Terminal/TerminalView.test.tsx#L424)

- Cover zero-size app focus recovery and reveal-time PTY geometry.
	[`TerminalView.test.tsx:499`](../../src/renderer/components/Terminal/TerminalView.test.tsx#L499)

- Prove picker visibility changes without replacing persistent terminals.
	[`App.test.tsx:219`](../../src/renderer/components/App.test.tsx#L219)

- Record unrelated test and lint baseline blockers outside this change.
	[`deferred-work.md:29`](deferred-work.md#L29)