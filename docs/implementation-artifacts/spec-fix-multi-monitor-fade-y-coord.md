---
title: 'Fix multi-monitor fade animation Y coordinate'
type: 'bugfix'
created: '2026-05-14'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** When monitors are stacked vertically (one above the other), the terminal fade-in starts from y=`-height` (absolute, relative to screen 0) instead of above the active monitor. On the lower monitor this causes the window to slide in from mid-screen; on the upper monitor the hide animation targets `y=-height` (below the monitor's top edge) so the terminal never fully disappears.

**Approach:** Replace the three hardcoded `-height` / `y=-height` constants in `animateShow`, `animateHide`, and instant-hide with monitor-relative calculations derived from the window's actual current position and height.

## Suggested Review Order

- [src/main/window-manager.ts](../../src/main/window-manager.ts) — three-line fix: `animateShow` startY, `animateHide` targetY, instant-hide y
