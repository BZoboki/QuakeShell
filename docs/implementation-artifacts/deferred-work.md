# Deferred Work

Pre-existing issues surfaced during code review but out of scope for the change that surfaced them. Entries are appended only — do not edit or remove existing ones.

- source_spec: `docs/implementation-artifacts/spec-fix-double-paste.md`
  summary: Right-click paste (`handleContextMenu` in TerminalView.tsx) re-implements paste manually via `navigator.clipboard.readText()` + direct `tab.input()` instead of delegating to xterm's own `terminal.paste(text)` API, so it skips xterm's CRLF/bracketed-paste normalization, bypasses the exited-session gating that the `onData` path provides, has no `.catch()` for clipboard-read failures, and has zero test coverage.
  evidence: Confirmed via blind-hunter review of the Ctrl+V double-paste fix (2026-08-12). xterm's bundled lib exposes `Terminal.prototype.paste(text)`, which applies the same normalization/bracketing as its native paste-event path and would also route through the existing `onData` exited-session check — switching `handleContextMenu` to call it would close all four gaps at once.

- source_spec: `docs/implementation-artifacts/spec-fix-double-paste.md`
  summary: The two `navigator.clipboard.writeText(...)` copy calls in TerminalView.tsx (the `onKey` Ctrl+C handler and `handleContextMenu`'s copy branch) have no `.catch()`, so a denied or unavailable clipboard fails silently with no user feedback.
  evidence: Confirmed via blind-hunter review of the Ctrl+V double-paste fix (2026-08-12); only `tab.close()` in this file currently handles a rejected promise.

- source_spec: `docs/implementation-artifacts/spec-fix-double-paste.md`
  summary: `window.quakeshell.tab.resize(...)` calls in TerminalView.tsx (the mount-time call and the `onResize` disposable) are fire-and-forget with no `.catch()`, even though the corresponding `tab:resize` IPC handler can reject.
  evidence: Confirmed via blind-hunter review of the Ctrl+V double-paste fix (2026-08-12).

- source_spec: `docs/implementation-artifacts/spec-fix-double-paste.md`
  summary: README documents `Ctrl+Shift+C` / `Ctrl+Shift+V` as copy/paste shortcuts, but TerminalView.tsx only matches lowercase `key === 'c'` (and paste is now fully delegated to xterm's plain-Ctrl+V native handling) — `KeyboardEvent.key` reports uppercase when Shift is held, so the documented shortcuts never fire.
  evidence: Confirmed via blind-hunter review of the Ctrl+V double-paste fix (2026-08-12); the same file already handles the shift-aware case correctly elsewhere (`e.shiftKey && e.key === 'D'` for split-pane), showing the pattern was known but not applied to copy/paste.

- source_spec: `docs/implementation-artifacts/spec-fix-double-paste.md`
  summary: `fitAddon.fit()` in TerminalView.tsx can be invoked twice for a single logical resize — the `window` `resize` listener and the `ResizeObserver` on the container both call it independently with no debouncing/coalescing.
  evidence: Confirmed via blind-hunter review of the Ctrl+V double-paste fix (2026-08-12).

- source_spec: `docs/implementation-artifacts/spec-fix-split-view-scrolling.md`
  summary: `SplitPane.tsx` destructures its `focusedPaneTabId` prop as `_focusedPaneTabId` and never uses it — there is no visual affordance distinguishing the focused pane from the unfocused one in a split view.
  evidence: Confirmed via blind-hunter review of the split-view scrolling fix (2026-08-12); pre-existing in `SplitPane.tsx`, which this fix did not modify — surfaced incidentally while reviewing the render-unification diff.

- source_spec: `docs/implementation-artifacts/spec-fix-split-terminal-history-lifetime.md`
  summary: The opacity focus-fade integration test BrowserWindow mock lacks `hide()`, causing two otherwise unrelated full-suite tests to fail.
  evidence: `npm test` and an isolated run of `src/main/opacity-focus-fade.integration.test.ts` both failed at `window-manager.ts` calling `win.hide()`; the terminal-history change modifies renderer files only.

- source_spec: `docs/implementation-artifacts/spec-fix-split-terminal-history-lifetime.md`
  summary: Repository-wide ESLint cannot establish a green baseline because existing alias-resolution and unrelated rule violations produce 25 errors and 80 warnings.
  evidence: `npm run lint` failed without reporting any changed file, while scoped ESLint over all changed TypeScript files completed successfully with no output.

- source_spec: `docs/implementation-artifacts/spec-terminal-hot-reload.md`
  summary: The shell picker can omit a newly installed pwsh or Git Bash because availability discovery still uses Electron's inherited parent PATH.
  evidence: `getAvailableShells()` runs `where` before the fresh registry PATH environment used by terminal reload spawning is constructed.

- source_spec: `docs/implementation-artifacts/spec-in-place-terminal-environment-refresh.md`
  summary: The `bash` alias is labeled Git Bash but resolves the first `bash.exe` on the inherited PATH, so a non-Git Bash may be selected without the `/usr/bin/cygpath` contract used by in-place refresh.
  evidence: `resolveAllowlistedShellPath('bash')` delegates to `bash.exe` path lookup without validating the Git-for-Windows runtime; the refresh template returns without mutating PATH when its bundled helpers are absent.
