---
read_when: changing counting, sessions, persistence, or the session controls
---
# Verification

Run `npm run check` for the build, typecheck, and editor transaction tests. Those cover added words versus net change, continuation of words, replacement, IME candidate revisions, supplementary Unicode letters, cross-note totals, paste/drop, cut/paste, ordinary deletion, grouped undo/redo, session boundaries, saved state validation, the 04:00 cutoff, and local daylight-saving dates.

`npm run smoke` launches the installed desktop Obsidian in a separate process and disposable profile/vault. On macOS the default binary is `/Applications/Obsidian.app/Contents/MacOS/Obsidian`. Set `OBSIDIAN_BINARY` for another installation. If the installation uses a newer downloaded app archive, set `OBSIDIAN_ASAR` to that archive. On macOS the runner tries to match the running app via the Obsidian CLI, then falls back to the newest downloaded archive. Set OBSIDIAN_ASAR explicitly to reproduce a particular version.

The smoke runner uses Playwright's CDP connection to drive the real Electron app, never the user's vault. It starts and ends sessions through the UI, types into the editor, pastes, deletes, switches notes, invokes undo/redo, changes modes, and reloads the plugin. A second reload runs with deliberately delayed storage writes to verify that queued progress survives replacement of the plugin instance. It checks both the visible counters and saved `data.json`. It records local screenshots in the ignored `docs/screenshots/` and a JSON result in the ignored `release/` directory. Its process, profile, and test vault are removed in a `finally` block. Evidence survives cleanup.

There is no hosted CI or deployment. The release artifact is a ZIP of `main.js`, `manifest.json`, and `styles.css`. Mobile, older Obsidian versions, clipboard-based dictation, and concurrent writers on several synced computers are outside the first-version runtime proof.
