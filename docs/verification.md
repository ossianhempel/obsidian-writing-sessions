---
read_when: changing counting, sessions, persistence, or the session controls
---
# Verification

The maintained workflow is the project skill
[verify-writing-sessions](../.agents/skills/verify-writing-sessions/SKILL.md).
Its [feature map](../.agents/skills/verify-writing-sessions/features/README.md)
records session, counting, goal, and history entry points.

Run `npm run check` for source-to-map consistency, build/typecheck, and transaction
regressions. Map checks derive commands, settings, and entry points from the
TypeScript source and reject missing commands, uncovered surfaces, and orphaned
feature files. The editor tests cover attribution, paste/cut/moves, grouped
undo/redo, IME/Unicode, note switching, persisted ownership, pause boundaries,
local 04:00 expiry, and daylight-saving dates.

For real desktop proof, use the control CLI from the repository root:

```sh
./scripts/control-writing-sessions doctor
./scripts/control-writing-sessions map --check
./scripts/control-writing-sessions dev
./scripts/control-writing-sessions doctor
./scripts/control-writing-sessions drive smoke
./scripts/control-writing-sessions stop
```

The initial doctor reports the exact launch command if there is no instance.
Always run stop after a drive, including after failure. `npm run smoke` wraps
launch, doctor, drive, and cleanup for unattended use.

Use Node.js 24+ and installed dependencies (`npm ci`). The macOS binary defaults
to `/Applications/Obsidian.app/Contents/MacOS/Obsidian`. Set `OBSIDIAN_BINARY` for
another installation, including Linux. `OBSIDIAN_ASAR` pins a downloaded archive;
without it macOS uses the newest local archive. Linux needs a display; the
repository's workflow uses Xvfb and a checksum-pinned Obsidian 1.15.0 AppImage.
No accounts or secrets are required. Do not start hosted workflows manually.

The CLI launches a separate Electron process group with a disposable profile and
vault. It installs the local build, uses an allocated local CDP port, and verifies
process/profile ownership, vault path, plugin version, and file hashes before
driving. It never attaches to the writer's vault. A lock prevents simultaneous
control mutations; a consumed fixture requires stop and a fresh dev launch.

The driver exercises actual buttons, the command palette, Settings, and editor
keystrokes/clipboard events. It checks visible counters, session IDs, saved
settings and ownership, pause persistence, delayed pending saves, celebrations,
reduced motion, and timer/wake/reload expiry. Only the disposable renderer's Date
changes; the machine clock is untouched. Detailed transaction invariants remain
unit-test evidence, not independent desktop coverage.

Each run prints `.verification/evidence/run-*/`. It retains screenshots,
`trace.zip` with action/DOM snapshots, logs, exact build identity, saved plugin
data, fixture note text, the result JSON, and process inventories. Require
`smoke-result.json` to contain `success: true` and no errors. Stop waits for its
owned process group to exit and removes only the scratch profile/vault and state
record. Evidence survives cleanup. A failed identity check preserves recovery
state rather than killing an unproven process group.

Local smoke proves the local build. It does not prove OS clipboard integration,
a complete app/OS restart, concurrent synced writers, mobile compatibility, or
published release contents. This plugin has no deployed health/version service.
A release needs separate downloaded-ZIP and disposable-install proof.
