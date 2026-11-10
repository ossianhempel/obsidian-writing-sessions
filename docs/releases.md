# Releases and Community-directory submission

## Release an update

Pushes to `main` and pull requests run typechecking, builds, tests and an isolated Obsidian 1.15.0 desktop smoke test under Xvfb. The Linux test runs on GitHub's standard `ubuntu-latest` runner, never a user's vault. Standard hosted runners are free for public repositories. We do not upload Actions artifacts or use a dependency cache.

After checks pass on `main`, the release job publishes the version in `manifest.json`. The GitHub token has `contents: write` only in that job. No personal token is required.

1. Update `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` with the new version. Use `npm version patch --no-git-tag-version` for the package files; update the manifest and versions map to match.
2. Run `npm ci`, `npm run package`, and `actionlint` locally. `npm run smoke` also works on a desktop when it can be driven without interrupting other work.
3. Push to `main`. A version already published is skipped; source-only pushes do not overwrite it. A lower version fails. Every version increase publishes automatically after the checks pass.

Release tags use `x.y.z` without `v`, exactly matching the manifest. Releases attach `main.js`, `manifest.json`, `styles.css`, and a convenience ZIP. Creation uses a draft followed by publication, so a failed asset upload leaves a hidden draft. The same commit can resume that draft; a different commit must use a new version or resolve the draft explicitly. Published release assets are never overwritten.

## First directory listing

The current submission route is [Obsidian's Community directory](https://community.obsidian.md), not a pull request editing `community-plugins.json`.

1. Sign in with your Obsidian account and link the GitHub account that owns this repository.
2. Choose **Plugins → New plugin** and submit `https://github.com/ossianhempel/obsidian-writing-sessions`.
3. Review the description, author and desktop-only requirement, agree to the developer policies and continued maintenance, then submit for review.
4. Resolve scanner feedback in source and publish an incremented version if required. Publish the listing once eligible.

The public repository, MIT license, README, manifest and matching GitHub release must exist before submission. Listing approval is separate from creating a release. Once listed, Obsidian obtains future versions from GitHub releases; users install updates through Obsidian's normal update controls. This plugin does not update itself.

Submission account linking and listing approval cannot be completed by a GitHub Actions token. There are no Obsidian account credentials in this repository.

Sources: [submission](https://docs.obsidian.md/plugins/releasing/submit-plugin), [account setup](https://docs.obsidian.md/community-directory/set-up-and-claim), [requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
