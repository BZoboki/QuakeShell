---
title: 'Fix Ctrl+V double-paste in terminal windows'
type: 'bugfix'
created: '2026-08-12'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Pressing Ctrl+V in a terminal window pasted the clipboard content twice, because xterm.js's native `paste` DOM event handler (bound to its hidden textarea) and a custom keydown handler in `TerminalView.tsx` both independently forwarded the clipboard text to the PTY.

**Approach:** Removed the redundant manual clipboard-read-and-forward branch from `attachCustomKeyEventHandler`, leaving xterm's built-in native paste handling (already wired through `onData` → `tab.input`) as the sole path. Added a regression test asserting the custom handler no longer intercepts Ctrl+V.

## Suggested Review Order

**Root cause fix**

- Removed the manual clipboard-read-and-forward branch for Ctrl+V so xterm's native paste event is the sole path.
  [`TerminalView.tsx:144`](../../src/renderer/components/Terminal/TerminalView.tsx#L144)

**Regression coverage**

- Asserts the custom key handler no longer reads the clipboard or forwards input directly on Ctrl+V.
  [`TerminalView.test.tsx:402`](../../src/renderer/components/Terminal/TerminalView.test.tsx#L402)
