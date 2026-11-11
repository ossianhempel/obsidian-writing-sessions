---
name: verify-writing-sessions
description: Verify the Writing Sessions desktop Obsidian plugin after changes to sessions, counting, goals, controls, history, persistence, or the 04:00 cutoff. Launch and drive an isolated real Obsidian through the project control CLI.
---

# Verify Writing Sessions

Use `./scripts/control-writing-sessions` from the repository root:

```sh
./scripts/control-writing-sessions doctor
./scripts/control-writing-sessions map --check
./scripts/control-writing-sessions dev
./scripts/control-writing-sessions doctor
./scripts/control-writing-sessions drive smoke
./scripts/control-writing-sessions stop
```

The CLI is the only way to interact with the verification app. Use its mapped
recipes; do not attach other tools to CDP, copy session state, write throwaway
scripts, or rediscover app commands from source. When a task needs a missing
action, extend the CLI or its smoke driver and document the feature recipe.
Read [the feature index](features/README.md), then only the feature file relevant
to the change. `map` lists the current command/setting inventory from source.

## Launch

Run `doctor` first. With no instance it exits nonzero and gives the `dev` command;
that is the expected initial result. With a healthy instance, coordinate with its
owner rather than launching another or driving it concurrently.

Use Node.js 24+ and `npm ci` if dependencies are absent. `dev` builds with
`npm run build`, creates an empty test vault and a distinct Electron user-data
directory, installs the exact local plugin build there, launches Obsidian with
an allocated local CDP port, accepts trust only in that vault, and waits for the
status bar. `PASS dev: ready` means it is ready for `doctor` and `drive smoke`.
The user's vault and running Obsidian remain separate.

On macOS the binary defaults to
`/Applications/Obsidian.app/Contents/MacOS/Obsidian`. `OBSIDIAN_BINARY` selects
another desktop binary; Linux requires that variable and a display such as Xvfb.
`OBSIDIAN_ASAR` pins the app archive. Without it macOS copies the newest downloaded
`obsidian-*.asar` from the local application-support directory. The selected
archive is recorded in evidence. This uses installed files and does not download
an app. No fixed port, external backend, or database setup is needed.

Only one control instance and mutating control command per checkout is allowed.
Use `stop` on your own instance before rebuilding or starting a fresh recipe.
`smoke` is the convenience command that builds, launches, drives, and stops in
one invocation; `npm run smoke` wraps it.

## Doctor

`doctor` is read-only. It checks Node/dependencies, the recorded process group and
profile, the CDP port from that profile, the actual vault path, plugin version,
status bar, and SHA-256 matches for the source and installed `main.js`, manifest,
and styles. A changed build requires `stop`, then `dev`. Run doctor again whenever
behavior looks wrong. A CDP endpoint alone is insufficient proof of identity.

## Seed accounts

There are no accounts, credentials, login, preview users, or remote services.
The disposable vault has empty `Draft.md`, `Second note.md`, and `Paused note.md`,
a ten-word goal, and no writing history. All typing and data mutations belong to
that fixture. Each drive requires a fresh instance; a completed or failed drive
must not be replayed against its modified fixture.

## Drive

`drive smoke` runs the existing Playwright Electron driver against the owned
instance. It covers every mapped feature in one ordered recipe; there are no
selective feature switches yet. Use real keys and accessible buttons, including
`Start session`, `Pause session`, `Resume session`, `End session`, and the
`Counting mode` combobox. The recipe also uses the real Obsidian command palette
and Writing Sessions settings. See the relevant feature file for entry points,
assertions, and limits. Controls not covered by a recipe remain unverified.

## Evidence

The CLI prints `.verification/evidence/run-*/` for this run. Retain it. It contains
build hashes and dirty-tree identity (`build.json`), Electron logs (`app.log`),
action/check output (`drive.log`), screenshots, persisted plugin data, note text,
`smoke-result.json`, and before/after process lists. Require `success: true`, no
renderer errors, the mapped checks, visible results, and the saved data assertions.
A build or a final screenshot alone does not prove an interaction.

Exercise the real user path and verify its side effects. The driver records real
clicks/keys and screenshots of resulting states, then checks counts against the
saved `data.json`. It may read plugin data for assertions, use Obsidian's file-open
and lifecycle APIs for fixture navigation/reload, and fix Date only in the
isolated renderer for cutoff cases. It delays the existing storage boundary for
the slow-save scenario. These do not replace session controls or typing with
internal setters. Local proof does not establish OS clipboard integration,
cloud sync, or published-release availability.

## Cleanup

Run `stop` after success and after every failed attempt. `drive` also stops on
failure; `smoke` stops in its finally block. Stop verifies the recorded profile
before signaling its exact process group, waits for owned processes to exit,
saves the post-run process list, then removes only that run's scratch vault,
profile, and state record. It retains evidence. It never kills by app name or
closes the user's Obsidian. After cleanup, require the CLI's process check to
pass and confirm the evidence files still exist. No simulators/emulators are
created: the plugin is desktop-only.

If the control process is killed uncatchably, its state record permits a later
`stop`. If a control-lock remains, inspect its recorded owner before removing
it; never steal another running command's lock. If the recorded process identity
cannot be proven, stop reports failure instead of signaling an unrelated group.

## Proof ladder

Run `npm run check` first for map consistency, build/typecheck, and transaction
regressions. Then run the local desktop recipe and cleanup above. No preview or
production service reports a build SHA, so there is no `health` subcommand.
Release claims additionally require checking the downloaded release ZIP and
installing it in a disposable vault; local smoke proves only the local build.
Community-directory submission, signing, and publishing require their own proof.

## Helpers

The control CLI uses `scripts/control-writing-sessions.mjs` for ownership and
inventory, and `scripts/smoke.mjs` for the fixed UI recipe. Invoke both through
the CLI. Extend those files for new actions and use `/maintain-verification-skill`
to update the map as behavior changes.
