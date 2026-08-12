---
title: 'Fix scrolling broken after linking two terminals into split view'
type: 'bugfix'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'a19993b2b8052ef21b39762be975ce44ef965e17'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Linking two tabs into a split pane destroys and recreates the xterm.js `Terminal` instance for the tab that was already open, wiping its scrollback buffer. Scrolling then appears broken because there is nothing behind the current viewport — the PTY keeps running, but the visual history is gone. Root cause: `App.tsx` renders the single-tab and split-tab layouts through two structurally different component trees (a bare `<TerminalView>` vs. a `<SplitPane>`-wrapped one), so Preact unmounts/remounts on every transition between them.

**Approach:** Always render the terminal area through `SplitPane` (it already supports a single pane at 100% width with no divider) and remove the separate bare-`TerminalView` branch in `App.tsx`, so the tab count changing never changes the top-level component type and existing `Terminal` instances survive link/disconnect transitions.

## Boundaries & Constraints

**Always:** Preserve the xterm.js `Terminal` instance and its scrollback across a tab entering or leaving a link group. Keep `SplitPane`'s existing single-pane rendering (100% width, no divider, same visual result as the current bare `TerminalView` path). Leave `tab-store.ts` linking/grouping logic untouched — this is a rendering-identity bug, not a state bug.

**Ask First:** If unifying rendering through `SplitPane` produces any visible layout/spacing difference for the ordinary single-tab (never-linked) case, stop and confirm with the user before proceeding — it must be pixel-equivalent to today's bare-`TerminalView` render.

**Never:** Do not add wheel/scroll event handlers — investigation confirmed no such handler is the cause. Do not modify `TerminalView.tsx`'s `Terminal` construction options or `xterm.js`/`global.css` viewport CSS. Do not touch main-process or IPC code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link two tabs | User links tab-1 (has scrollback) with tab-2 via the tab-bar link button | tab-1's `Terminal` DOM node is not remounted; its scrollback stays scrollable; tab-2 mounts fresh normally | N/A |
| Disconnect back to one tab | User disconnects a linked pair, leaving one tab | The remaining tab's `Terminal` DOM node is not remounted; its scrollback stays scrollable | N/A |
| Never-linked single tab | App shows one ungrouped tab | Renders visually identical to pre-fix behavior (full-width pane, no divider) | N/A |

</frozen-after-approval>

## Code Map

- `src/renderer/components/App.tsx:808-836` -- mutually exclusive render branches: `<SplitPane>` when `currentGroupTabIds.length > 1`, bare `<TerminalView key={displayTabId}>` when `<= 1`. This type switch is the remount trigger. Merge into one always-`SplitPane` render guarded by `displayTabId && !showPicker && currentGroupTabIds.length >= 1 && currentFocusedPane`.
- `src/renderer/components/SplitPane/SplitPane.tsx:14-59` -- pane wrapper `div` already keyed by `key={\`pane-${tabId}\`}`; `paneWidth` calc already resolves to 100% with no divider when `tabIds.length === 1`. No change expected here, but confirm behavior is unchanged for the single-tab case once it's the only path.
- `src/renderer/components/Terminal/TerminalView.tsx:61-219` -- mount effect creates a `Terminal` and disposes it on unmount with no external scrollback cache; confirms *why* a remount destroys history. Not the fix location.
- `docs/implementation-artifacts/p2-3-3-close-pane.md:196-204` -- documents the originally-intended invariant ("matching keys ensure the DOM node is reused... preserving xterm.js state and scrollback") that was never applied for the link-into-split direction.
- `src/renderer/components/App.test.tsx:191,256,295,362` -- existing split-mode assertions on `[data-testid="split-pane"]` textContent; unaffected.
- `src/renderer/components/App.test.tsx:370-372,403` -- existing single-tab assertions expect a bare `[data-testid="terminal-tab-X"]` node; must be rewritten to assert against the mocked `split-pane` textContent (e.g. `tab-3|tab-3`) since single tabs now render through `SplitPane` too.

## Tasks & Acceptance

**Execution:**
- [x] `src/renderer/components/App.tsx` -- Merge the two conditional render branches (~lines 808-836) into one `<SplitPane tabIds={currentGroupTabIds} focusedPaneTabId={currentFocusedPane} .../>` render, guarded by `displayTabId && !showPicker && currentGroupTabIds.length >= 1 && currentFocusedPane`; delete the standalone `<TerminalView key={displayTabId} .../>` branch. -- Removes the component-type switch that unmounts/remounts xterm.js on link/disconnect.
- [x] `src/renderer/components/App.test.tsx` -- Update the assertions at lines ~370-372 and ~403 to check the mocked `split-pane` element's textContent (e.g. `'tab-3|tab-3'`) instead of a bare `terminal-tab-X` testid, since ungrouped tabs now render through `SplitPane` too; add one new test that links two tabs with an already-mounted tab and asserts the existing tab's rendered node is not recreated (e.g. assert the underlying element/testid persists across the render rather than being removed and re-added). -- Keeps coverage aligned with the unified render path and directly regression-tests the fix.

**Acceptance Criteria:**
- Given a tab with an active session and existing scrollback, when the user links it with a second tab into split view, then that tab's terminal DOM node is not remounted and its scrollback remains scrollable.
- Given a linked pair, when the user disconnects back to one tab, then that tab's terminal DOM node is not remounted and its scrollback remains scrollable.
- Given no tabs are linked, when the app renders, then the terminal area is visually and behaviorally unchanged from before this fix.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including updated `App.test.tsx` and existing `SplitPane.test.tsx`.
- `npm run lint` -- expected: no new lint errors.

**Manual checks (if no CLI):**
- Run the dev app, open two tabs, generate scrollback in one (e.g. run a command with long output), link it with the other tab into split view, and confirm the wheel still scrolls that pane and the prior output is still present. Disconnect and confirm scrollback is still intact on the remaining single tab.

## Suggested Review Order

**Root-cause fix — unify the terminal render path**

- Entry point: every displayed tab (grouped or not) now renders through one component, so tab-count changes never swap component types.
  [`App.tsx:831`](../../src/renderer/components/App.tsx#L831)

- Explains why `SplitPane` now owns the ungrouped case too, since its name alone doesn't convey that.
  [`App.tsx:826`](../../src/renderer/components/App.tsx#L826)

**Correctness follow-up — stale keyboard-target regression from the render unification**

- Guards Ctrl+W/Ctrl+Shift+D against a stale `focusedPaneTabId` set by a pane that mounted via the now-universal `onFocusCapture` wiring.
  [`App.tsx:162`](../../src/renderer/components/App.tsx#L162)

**Regression coverage — DOM-identity mechanism against the real `SplitPane`**

- Directly proves the fix's core guarantee: an existing pane's node survives `tabIds` growing from one to two.
  [`SplitPane.test.tsx:145`](../../src/renderer/components/SplitPane/SplitPane.test.tsx#L145)

- Confirms the single-tab path is pixel-equivalent to the removed bare-`TerminalView` render (full width, no divider).
  [`SplitPane.test.tsx:112`](../../src/renderer/components/SplitPane/SplitPane.test.tsx#L112)

**Regression coverage — App-level link/disconnect transitions**

- End-to-end check that linking an already-displayed tab reuses the same `split-pane` DOM node.
  [`App.test.tsx:191`](../../src/renderer/components/App.test.tsx#L191)

- Same check for the reverse direction: disconnecting back to one tab must not remount it either.
  [`App.test.tsx:363`](../../src/renderer/components/App.test.tsx#L363)
