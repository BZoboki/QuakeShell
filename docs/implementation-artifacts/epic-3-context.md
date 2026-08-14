# Epic 3 Context: Application Lifecycle & System Integration

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make QuakeShell dependable as an always-available Windows utility: start quietly when enabled, maintain one active instance, offer WSL alongside PowerShell, and provide system-level controls, recovery, display placement, notifications, and update awareness without interrupting the terminal workflow or destroying active session state.

## Stories

- Story 3.1: Single Instance Enforcement and Silent Autostart
- Story 3.2: WSL Shell Support
- Story 3.3: Tray Interactions and Context Menu
- Story 3.4: Shell Crash Recovery and Exit Handling
- Story 3.5: Multi-Monitor Support
- Story 3.6: Windows Notifications and Update Checking

## Requirements & Constraints

- Support Windows 10 version 1809 or later and Windows 11. Use the Windows pseudo-console path so PowerShell and the default WSL distribution behave as terminal shells with ANSI output.
- Acquire the single-instance lock before other application initialization. A second launch must signal the existing process to bring its terminal into view, then exit. This prevents duplicate lifecycle state and PTY processes.
- When autostart is enabled, register the Windows login item; when disabled through live configuration, remove it. Startup must remain invisible: no splash screen, tray balloon, or visible terminal. Pre-create the window and shell in the background and reach tray-ready in under three seconds.
- Spawn WSL through the system WSL executable when selected as the default shell. A missing or unavailable WSL installation must leave a clear dimmed terminal error and a scoped log entry; configured custom executable paths remain valid shell choices.
- Treat the tray as the native fallback control surface. Left click toggles the existing terminal with its normal animation. The right-click menu must offer Toggle Terminal with the configured shortcut label, Edit Settings, Check for Updates, About, and Quit. Editing settings opens the JSON configuration in the OS-associated editor; quit saves state, ends PTYs cleanly, removes the tray icon, and exits.
- Use light and dark tray icon variants according to the Windows system theme. Retain keyboard-first access; tray interactions are a recovery and control path, not a replacement for the hotkey.
- Preserve the terminal's last output when its shell exits and display a dimmed exit status. The detailed epic flow specifies that Enter starts a new shell in the same session and that the app must not enter an automatic restart loop. Hidden-terminal crashes should raise a native notification whose action brings the terminal into view.
- Place the terminal on the display containing the currently focused work. Recalculate its full width and configured height percentage for that display before showing. On monitor removal, fall back to the primary display; single-display behavior should stay simple.
- Check for updates periodically without blocking local terminal use, and provide a manual tray command. Show an available-update notification, remain quiet when there is no periodic update, and fail offline without user-facing errors. Do not install updates silently; users decide when to update.
- Send native terminal-attention notifications only while the terminal is hidden or unfocused, and bring/focus it when the user acts on one. Planning material conflicts with this requirement by also prohibiting toast bubbles; resolve that policy before implementing notification presentation.
- The planning material also disagrees on shell-crash recovery and update implementation: it alternates between automatic versus user-triggered shell restart, and between npm-registry checks and installer or release-based updating. The detailed Epic 3 acceptance criteria should govern behavior until those decisions are reconciled.

## Technical Decisions

- Keep Windows lifecycle, tray, display, notification, and PTY concerns in the Electron main process. The terminal manager owns shell spawn, I/O, exit detection, and restart; lifecycle orchestration owns single-instance, login-item, startup, and update behavior; window management owns display-aware placement; and tray and notification concerns invoke those services rather than duplicating state.
- Preserve the established process boundary: renderer requests use typed context-bridge APIs, while main-process events push terminal data, window state, configuration changes, and notification events. Define every channel centrally using `domain:action` names; no raw renderer IPC exposure or ad hoc channel strings.
- Main-process modules communicate through direct calls. Register Electron IPC only at the dedicated handler boundary, where errors are caught, logged, and returned as structured failures to the renderer.
- Use scoped logging for lifecycle events, shell starts/exits, WSL failures, update failures, and degraded fallbacks. Recoverable problems should preserve the primary workflow and expose a clear fallback rather than being silently swallowed.
- Rebuild native PTY dependencies against Electron, use async/await for lifecycle operations, and keep tests next to their owning main-process modules. Exercise real Electron system behavior with end-to-end coverage for autostart-safe startup, secondary launches, tray commands, WSL spawn failures, display reassignment, and notification actions.

## UX & Interaction Patterns

- The application is tray-resident, unobtrusive infrastructure. A dismiss action hides rather than closes the terminal, preserving processes, working directory, and scrollback across normal show/hide cycles.
- Implement the context menu with native Electron tray and menu APIs, not renderer UI. Keep the startup experience silent and the update path non-modal.
- Choose the active-work display before the show animation, so the terminal arrives where the user is working. Use the primary display as the graceful-disconnect fallback and calculate height relative to each display.
- Shell-exit feedback belongs in the terminal as a persistent dimmed status, allowing the user to restart on Enter. Native attention notifications must be non-disruptive and reserved for hidden or unfocused states, subject to the unresolved toast-policy conflict.

## Cross-Story Dependencies

- This epic builds on the pre-created hidden window, toggle animation, tray foundation, terminal session ownership, configuration persistence, and secure IPC boundary from Epic 1.
- It relies on Epic 2 live configuration for `autostart` and `defaultShell`. Changing the default shell must affect subsequently spawned sessions without destroying existing state; the shell-exit restart flow is the relevant way to apply it to an exited session.
- Single-instance startup, tray commands, notification actions, monitor placement, and update checks all converge on lifecycle and window visibility control. Maintain one source of truth for window visibility and session ownership so a secondary launch, tray click, notification click, or monitor event cannot create a second process or session.
- Tray update commands and periodic checks must share the same update path. Terminal exit events must feed both terminal status rendering and hidden-state notification policy without notifying while the user is already focused on the terminal.