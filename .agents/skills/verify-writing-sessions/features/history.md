# History and cutoff

Daily totals combine sessions. History and ownership survive reload, while every
unfinished session, including a paused one, ends at local 04:00.

<!-- surface: command:open-controls -->

## Sub-features

- `history`: controls show current progress, daily totals, and prior sessions.
- `reload`: persisted counts and ownership survive plugin replacement.
- `slow-save`: replacement drains pending storage writes.
- `cutoff`: timer, first edit after wake, and startup close expired sessions.

## How to get to it (user POV)

Click the status bar or select `Writing Sessions: Open session controls and history`
in the command palette. Scroll through Daily history and Sessions. Return after
04:00 to see a fresh daily total and a requirement to start manually.

## Driving it with control-writing-sessions

Preconditions: fresh `dev` instance; `doctor` passes.

Run `./scripts/control-writing-sessions drive smoke`. The recipe opens controls
through the status bar and command palette, combines two sessions, reloads the
plugin, deletes/restores only active-session credit, then reloads with delayed
storage. It advances only the fixture renderer's Date to the cutoff and requires
the paused session to end exactly then, today's total to reset, and later typing
to remain uncounted until manual start. Missed-cutoff edit and reload paths must
also close at the original cutoff. Inspect `session-history.png`, the saved
`data.json`, and all cutoff/reload check results.

## Gotchas

- Fixed Date does not change the system clock. Timers continue normally.
- A plugin reload proves its lifecycle; a full OS restart is not part of smoke.
- Cross-computer sync and multiple concurrent writers are unsupported.
- Screenshots alone do not prove saved end timestamps; require data assertions.
