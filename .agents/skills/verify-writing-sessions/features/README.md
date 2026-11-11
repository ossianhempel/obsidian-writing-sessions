# Writing Sessions verification map

The primary surface is the desktop Obsidian UI. The command palette, status bar,
and settings all act on the same vault-local plugin state. There is no product
web UI, service, account, or mobile target.

Start with `./scripts/control-writing-sessions doctor`, then `map --check`.
Use `dev` for an owned disposable instance and require doctor to pass before
`drive smoke`. The current recipe covers all features together and requires the
fresh empty fixture. End with `stop`. Keep the evidence directory it prints.

Inventory markers in each feature file are checked against source on every
`map --check`. All features must appear in this index. There are no inventory
exemptions. A mapped entry point not exercised in a run is not verified by a
successful check through a different entry point. User-assigned hotkeys are not
separate built-in commands and are outside the fixed recipe.

## Features

- [Sessions](./sessions.md): start, pause, resume, end; status bar and commands.
- [Word counting](./counting.md): added/net modes, editing and undo across notes.
- [Daily goals](./goals.md): settings, celebrations, reduced motion.
- [History and cutoff](./history.md): controls, persistence, 04:00 and missed wake.
