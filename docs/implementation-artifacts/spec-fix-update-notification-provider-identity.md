---
title: 'Fix Windows Update Notification Identity'
type: 'bugfix'
created: '2026-08-14'
status: 'done'
route: 'one-shot'
---

# Fix Windows Update Notification Identity

## Intent

**Problem:** Windows Notification Center attributes QuakeShell update notifications to Electron because the main process does not configure a Windows AppUserModelID.

**Approach:** Assign the Windows AppUserModelID registered by QuakeShell's installed shortcut during primary-instance initialization, before main-process lifecycle handlers and any notification can run.

## Suggested Review Order

- Assigns the stable Windows notification provider identity before app readiness.
  [app-lifecycle.ts:207](../../src/main/app-lifecycle.ts#L207)

- Verifies Windows-only configuration and early lifecycle ordering.
  [app-lifecycle.test.ts:110](../../src/main/app-lifecycle.test.ts#L110)