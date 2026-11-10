# Changelog

## 0.2.0 — 2026-11-10

- Subtract deleted words only when they were credited to the active writing session. Older text and pasted words do not reduce the added-word counter.
- Keep credit through spelling edits, note switches, single-selection cut/paste, editor move-line commands, and undo/redo. Rewriting session words no longer inflates the count.
- Persist word ownership with fingerprints so deletions still subtract correctly after restarts for unchanged notes. Migrate existing totals without recalculating history.
- Add versioned GitHub releases on pushes to main, gated on tests and an isolated Obsidian run. Require desktop Obsidian 1.15 or newer.
- The active writing vault is not changed by the release pipeline.

## 0.1.0 — 2026-11-09

- Manual writing sessions with a live status-bar counter across notes.
- Words added and net change, with paste excluded from writing credit.
- Daily word cue, local 04:00 day boundary, and daily/session history.
- Saved session state and undo/redo accounting through CodeMirror history.
