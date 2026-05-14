---
title: 'Fix multi-monitor fade animation Y coordinate'
type: 'bugfix'
created: '2026-05-14'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** When monitors are stacked vertically (one above the other), the terminal fade-in starts from y=`-height` (absolute, relative to screen 0) instead of above the active monitor. On the lower monitor this causes the window to slide in from mid-screen; on the upper monitor the hide animation targets `y=-height` (below the monitor's top edge) so the terminal never fully disappears. Even after fixing the y math, when the active monitor is the *bottom* one the slide-up parks the window inside the upper monitor's bounds — still visible.

**Approach:** Replace the three hardcoded `-height` / `y=-height` constants in `animateShow`, `animateHide`, and instant-hide with monitor-relative calculations derived from the window's actual current position. Then call `win.hide()` after both hide paths so the window truly disappears regardless of where the off-screen `y` lands geometrically.

## Suggested Review Order

- [src/main/window-manager.ts](../../src/main/window-manager.ts) — `animateShow` startY, `animateHide` targetY, instant-hide y, plus `win.hide()` after both hide paths
