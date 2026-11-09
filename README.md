# Writing Sessions

A small Obsidian plugin for building a writing habit. Start a session, write across as many notes as you like, and see your progress without remembering each note's starting word count.

The default daily cue is **100 words**. Keep going when you reach it. There are no popups, streaks, or timers.

## How it works

- Start and end sessions from the status bar or command palette. Assign your own shortcuts in Obsidian's Hotkeys settings.
- The status bar shows the current session and today's total across sessions.
- Click it for session controls, a counting-mode switch, daily totals, and session history.
- Sessions and progress survive a restart. An unfinished session stays active until you end it.
- The writing day starts at **04:00 local time**. Writing at 01:00 belongs to the previous day. An active session can span several writing days.
- Change the daily cue in Settings → Writing Sessions.

### Counting rules

**Words added** is the default. It credits words typed during an active session, including words you later delete. Pasted text and drag-and-drop earn no credit. Cut and paste won't count the same words twice. Undo removes the credit for the original insertion; redo restores it.

**Net change** measures the change in word count from manual editor actions during sessions. It includes pasted text and subtracts deleted words, even if those words were written earlier. Cutting and pasting between tracked notes cancels out. Net change can be negative. Switching modes changes the displayed metric, not the stored history.

Continuing an existing word does not count another word. Replacing whole words with newly typed words counts as new writing. Words are groups of letters or numbers, with internal apostrophes and hyphens allowed. Markdown punctuation alone does not count. Text in headings, links, code, and frontmatter follows the same rule. This is a writing-activity counter, not a rendered-prose parser.

Background imports, sync changes, and unannotated programmatic edits are ignored. Other plugins that imitate typing events may count as typing. Clipboard-based dictation is treated as paste and earns no added-word credit. Undo credit follows the original session and day, even if that session has ended. Obsidian does not retain this plugin's undo effects after an app restart or plugin reload.

## Install

Desktop Obsidian 1.8 or newer is required. The plugin is not yet in the community directory.

1. Build from source below, or use a provided plugin ZIP.
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

`npm run check` typechecks, builds the CommonJS plugin, and runs tests against real CodeMirror transactions and undo history. `npm run package` also produces `release/writing-sessions.zip`, containing only the three install files. `npm run dev` rebuilds on changes.

To smoke-test in a separate Obsidian desktop instance:

```sh
npm run smoke
```

See [verification](docs/verification.md) for prerequisites and the evidence covered. No hosted CI jobs are configured.

## Privacy and storage

No network requests, analytics, account, or cloud service. Only session timestamps, aggregate word counts per writing day, your target, and counting mode are saved in the plugin's `data.json`. Note contents, note names, and edit text are not saved by this plugin.

History is per vault and currently intended for one desktop writer. Syncing the same plugin data between concurrently active computers is not supported; the most recently synced data file can replace another computer's counts. Back up your vault as usual.

## License

[MIT](LICENSE).
