# Sessions

A writer starts a session, pauses to write without counting, resumes the same
session, and ends it when finished.

<!-- surface: entry:status-bar -->
<!-- surface: setting:Current session -->
<!-- surface: command:start-session -->
<!-- surface: command:pause-session -->
<!-- surface: command:resume-session -->
<!-- surface: command:end-session -->

## Sub-features

- `start-end`: controls and command-palette actions start and end sessions.
- `pause-resume`: new writing is ignored while paused; resume keeps the ID/counts.
- `pause-reload`: paused state survives plugin reload.
- `command-state`: only valid actions are available for the current session state.

## How to get to it (user POV)

Click the Writing Sessions status bar and use `Start session`, `Pause session`,
`Resume session`, or `End session`. Alternatively open Obsidian's command palette
and select `Writing Sessions: Start/Pause/Resume/End writing session`.
Obsidian Hotkeys settings can assign a shortcut to those same commands.

## Driving it with control-writing-sessions

Preconditions: fresh `dev` instance; `doctor` passes; no previous drive.

Run `./scripts/control-writing-sessions drive smoke`. The recipe clicks the status
bar, starts through its button, types nine words, and later pauses after saving
progress. It types in `Paused note.md` without changing totals, undoes/redoes that
text, reloads, and requires `Paused: 4`. Resume through the visible button allows
two more credited words with the same session ID. It also runs each session
command through the visible command palette and checks which commands are
available. Screenshots include `session-controls.png`, `session-paused.png`,
`session-paused-dark.png`, and `session-resumed.png`. Require these checks in
`smoke-result.json`, the saved session state, and no renderer errors.

## Gotchas

- Pause ignores new manual edits; undo/redo still follows original credit.
- `Start` is unavailable while paused; use Resume or End.
- Each drive consumes its fixture. Stop and launch before another drive.
- Hotkey assignment itself is outside the recipe; command execution is covered.
