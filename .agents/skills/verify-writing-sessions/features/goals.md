# Daily goals

The daily word cue and counting mode are configurable. Crossing the cue
celebrates once per writing day with a reduced-motion alternative.

<!-- surface: entry:settings-tab -->
<!-- surface: setting:Daily word cue -->
<!-- surface: setting:Celebrate daily goal -->

## Sub-features

- `settings`: change cue, mode, and celebration through Settings.
- `celebrate`: crossing ten words shows the announcement and status-bar pulse.
- `reduced-motion`: reduced motion keeps the text without the animation.
- `once`: undo, sessions, and reload do not repeat that day's celebration.

## How to get to it (user POV)

Open Obsidian Settings → Writing Sessions. Set `Daily word cue`, `Counting mode`,
or `Celebrate daily goal`. Start a session and type past the cue to see the result
in the status bar.

## Driving it with control-writing-sessions

Preconditions: fresh `dev` instance; `doctor` passes; fixture goal is ten words.

Run `./scripts/control-writing-sessions drive smoke`. The settings path changes
the cue to 12, disables celebration, and selects net; it checks the resulting
saved values, then restores ten/added/enabled for the typing scenario. Crossing
thirteen words requires `Daily goal reached!`, the `writing-sessions-goal`
animation, and the live announcement. Reduced motion must disable the animation.
The same day stays celebrated after reload. Inspect `settings.png`,
`daily-goal.png`, saved data evidence, and the corresponding check results.

## Gotchas

- Goal completion is a cue; writing continues beyond it.
- Celebration is once per writing day, not per session or per goal edit.
- Reduced motion is emulated in the isolated renderer, not changed in macOS.
