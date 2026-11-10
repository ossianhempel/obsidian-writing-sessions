---
read_when: changing counting, sessions, persistence, or the session controls
---
# Verification

Run `npm run check` for the build, typecheck, and editor transaction tests. Those cover added words versus net change, continuation of words, replacement, IME candidate revisions, supplementary Unicode letters, cross-note totals, paste/drop, cut/paste, ordinary deletion, grouped undo/redo, session boundaries, saved state validation, the 04:00 cutoff, and local daylight-saving dates.

The retained-word tests also cover mixed old/new selections, partial-word deletion, rewrites, merging/splitting words, actual CodeMirror move-line commands, cut/paste followed by undo in the source note, reopening unchanged notes, switching files in one editor, mirrored edits in two panes, and rejecting stale document attribution. A deterministic sequence checks 1,000 edits plus undo/redo against the remaining word count of a document written entirely in the session.

Review regressions cover background edits after full deletion, mirrored insertions at and inside undo ranges, grouped replacements with both undo and redo branches remapped, history predating plugin load (including adjacent typing and remapping after older undo), pending note loads with intervening selection changes, original credit reversal after background deletion, global baseline priority, real linewise paste over a selection, and metadata-only note switches. Undo uses positionless receipts with separately rebased inverse steps.

Review regressions also cover undo/redo eligibility across session boundaries (including rapid edits), rejected snapshots returning to their former text, and actual character-transposition commands within a word and across an old/new word boundary.

Release **0.2.0**, commit `acdc4297f97c`, passed **98 tests** and the complete isolated Obsidian 1.15.0 Linux smoke run in [GitHub Actions](https://github.com/ossianhempel/obsidian-writing-sessions/actions/runs/42811560985). The run verified note switching, deletion and undo, persistence through plugin reload, and immediate reload with slow pending writes, without uncaught renderer errors. The published install files match the local build byte for byte, and the release ZIP contains those same three files.

The macOS smoke run was not started during this work, to avoid interrupting an active writing session. No plugin files in the user's vault were changed. JSON restart tests also cover stale and missing notes, migration, unchanged-total spelling edits, and shared moved-word identities across notes. Startup validates exact normalized fingerprints against open editor text when available, then falls back to disk for closed notes; this preserves ownership while Obsidian has unsaved editor changes.

`npm run smoke` launches the installed desktop Obsidian in a separate process and disposable profile/vault. On macOS the default binary is `/Applications/Obsidian.app/Contents/MacOS/Obsidian`. Set `OBSIDIAN_BINARY` for another installation. If the installation uses a newer downloaded app archive, set `OBSIDIAN_ASAR` to that archive. On macOS the runner tries to match the running app via the Obsidian CLI, then falls back to the newest downloaded archive. Set OBSIDIAN_ASAR explicitly to reproduce a particular version.

The smoke runner uses Playwright's CDP connection to drive the real Electron app, never the user's vault. It starts and ends sessions through the UI, types into the editor, pastes, deletes, switches notes, invokes undo/redo, changes modes, and reloads the plugin. A second reload runs with deliberately delayed storage writes to verify that queued progress survives replacement of the plugin instance. It checks both the visible counters and saved `data.json`. It records local screenshots in the ignored `docs/screenshots/` and a JSON result in the ignored `release/` directory. Its process, profile, and test vault are removed in a `finally` block. Evidence survives cleanup.

The GitHub Actions check job runs the same package checks plus the smoke runner in Linux under Xvfb, using a checksum-pinned Obsidian 1.15.0 AppImage. Releases are gated on those checks. The release artifact is a ZIP of `main.js`, `manifest.json`, and `styles.css`. Mobile, older Obsidian versions, clipboard-based dictation, and concurrent writers on several synced computers are outside the first-version runtime proof.
