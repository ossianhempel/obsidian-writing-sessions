# Writing Sessions

A small Obsidian plugin for building a writing habit. Start a session, write across as many notes as you like, and see your progress without remembering each note's starting word count.

The default daily cue is **100 words**. Keep going when you reach it. There are no popups, streaks, or timers.

## How it works

- Start, pause, resume, and end sessions from the status bar or command palette. Assign your own shortcuts in Obsidian's Hotkeys settings.
- The status bar shows the current session and today's total across sessions.
- Click it for session controls, a counting-mode switch, daily totals, and session history.
- Pause keeps the same session and its counts. Manual edits while paused do not count; undo and redo still reverse or restore the original edit’s credit. Resume when you want to count writing again.
- Sessions, pause state, and progress survive a restart within the same writing day. Every unfinished session, including paused sessions, ends automatically at **04:00 local time**. If Obsidian was closed or asleep, it closes the expired session on return, recording the cutoff as its end time.
- Writing at 01:00 belongs to the previous day. At 04:00 the daily counter resets; start a new session manually to count more writing. Previous days and sessions stay in history.
- Change the goal in **Settings → Writing Sessions → Daily word cue**.
- Reaching the goal briefly pulses the status bar and shows “Daily goal reached!”. It celebrates once per writing day, across sessions and restarts. Reduce Motion keeps the message without movement. Turn it off with **Celebrate daily goal** in the same settings.

### Counting rules

**Words added** is the default. It counts new words that remain from the current session. Deleting those words subtracts their credit. Deleting older words, words from a previous session, or pasted text does not reduce this count. Editing a word's spelling keeps one word credited; replacing two session words with one leaves one credited. Pasted text and drag-and-drop earn no new credit.

Cutting session words temporarily removes their credit. A matching single-selection paste in the same session transfers that credit, including across notes. Repeated pastes earn no additional credit. Moving lines with the editor commands also preserves credit. Undo and redo restore both the text and its word credit, without counting a moved word twice.

**Net change** measures the change in word count from manual editor actions during sessions. It includes pasted text and subtracts deleted words, even if those words were written earlier. Cutting and pasting between tracked notes cancels out. Net change can be negative. Switching modes changes the displayed metric, not the stored history.

Continuing an existing word does not count another word. Replacing older words with newly typed words counts as new writing. Words are groups of letters or numbers, with internal apostrophes and hyphens allowed. Markdown punctuation alone does not count. Text in headings, links, code, and frontmatter follows the same rule. This is a writing-activity counter, not a rendered-prose parser.

Background imports, sync changes, and unannotated programmatic edits are ignored. Other plugins that imitate typing events may count as typing. Clipboard-based dictation is treated as paste and earns no added-word credit. Undo credit follows the original session and day, even if that session has ended. Obsidian does not retain this plugin's undo effects after an app restart or plugin reload.

Word ownership survives app restarts and plugin reloads when the note's contents still match the saved fingerprint. Changed or missing notes lose their old ownership metadata while saved totals stay unchanged. The plugin never guesses which externally edited words belong to you. Upgrading from the original release keeps totals and treats existing text as baseline, since that release did not save word ownership. Clipboard cut transfers and Obsidian's undo history do not survive a restart.

## Install

Desktop Obsidian 1.15 or newer is required. The plugin is not yet in the community directory.

1. Download the [latest release ZIP](https://github.com/ossianhempel/obsidian-writing-sessions/releases/latest/download/writing-sessions.zip), or build from source below.
2. Create `<your-vault>/.obsidian/plugins/writing-sessions/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Reload Obsidian and enable **Writing Sessions** under Community plugins.
5. Run **Writing Sessions: Start writing session** from the command palette.

If your vault uses a custom configuration folder, use that folder instead of `.obsidian`.

## Build and test

Use Node.js 24 or newer.

```sh
npm ci
npm run check
npm run package
```

`npm run check` validates the verification map, typechecks, builds the CommonJS plugin, and runs tests against real CodeMirror transactions and undo history. `npm run package` also produces `release/writing-sessions.zip`, containing only the three install files. `npm run dev` rebuilds on changes.

To smoke-test in a separate Obsidian desktop instance:

```sh
npm run smoke
```

Use the project [verification skill](.agents/skills/verify-writing-sessions/SKILL.md) for controlled launch, diagnosis, driving, and cleanup. See [verification](docs/verification.md) for prerequisites and evidence. Pushes and pull requests run the checks and an isolated Obsidian test on GitHub Actions. See [releases](docs/releases.md) for automatic publishing and Community-directory submission.

## Privacy and storage

No network requests, analytics, account, or cloud service. The plugin's `data.json` saves session timestamps, aggregate word counts per writing day, your target, counting mode, celebration preference and celebrated days, and word ownership metadata: note paths, SHA-256 fingerprints, word positions, and session/day identifiers. Note contents and clipboard text are not saved. Totals and ownership are written together so a completed save describes the same edit.

To follow words through edits and moves, the plugin holds document snapshots and the most recent cut text in memory. Ownership fingerprints use the desktop Node crypto API; this release is desktop-only. Renames performed while the plugin is active update stored paths, including folder renames. Notes renamed while the plugin is closed become baseline on the next start.

History is per vault and currently intended for one desktop writer. Syncing the same plugin data between concurrently active computers is not supported; the most recently synced data file can replace another computer's counts. Back up your vault as usual.

## License

Free and open source under the [MIT license](LICENSE).
