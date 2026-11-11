# Word counting

Writing across notes earns added-word credit. Net change includes paste and
older-word deletion; switching display mode preserves both stored counts.

<!-- surface: command:toggle-counting-mode -->
<!-- surface: setting:Counting mode -->
<!-- surface: setting:Show -->

## Sub-features

- `typing`: typed words count across notes in the same session.
- `delete-history`: deletion, undo, and redo remove and restore original credit.
- `paste`: paste increases net without earning added-word credit.
- `mode`: controls, settings, and command palette select the displayed metric.

## How to get to it (user POV)

Start a session, then type in a note. Click the status bar and change `Show` to
`Words added` or `Net change`. Also available in Settings → Writing Sessions →
`Counting mode`, and `Writing Sessions: Toggle words added / net change` in the
command palette.

## Driving it with control-writing-sessions

Preconditions: fresh `dev` instance; `doctor` passes.

Run `./scripts/control-writing-sessions drive smoke`. Require nine typed words,
zero after deletion, nine after undo, and thirteen across two notes. The real
editor paste produces 13 added / 19 net. The `Counting mode` combobox changes
the visible counter to `19 / 10 net`; settings and the palette also change the
mode without changing stored totals. The reload/deletion sequence proves saved
ownership. Inspect `writing-counter.png`, `settings.png`, the saved `data.json`,
and named check results in the evidence directory.

## Gotchas

- Clipboard injection uses an editor ClipboardEvent; OS clipboard/dictation is
  not established by that check.
- File-open and lifecycle APIs only navigate fixtures/reload; credit requires
  real editor keystrokes or clipboard events.
- Detailed cut/move/IME/Unicode invariants also require `npm run check`; the desktop
  smoke does not independently exercise every transaction-test case.
