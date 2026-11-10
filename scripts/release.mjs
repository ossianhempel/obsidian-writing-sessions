import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { releaseMetadata } from './check-release.mjs';
const manifest = await releaseMetadata();
assert.equal(process.env.GITHUB_REPOSITORY, 'ossianhempel/obsidian-writing-sessions');
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
const releases = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`])).flat();
const existing = releases.find(release => release.tag_name === manifest.version);
const versionParts = value => value.split('.').map(Number);
const compare = (a, b) => { const x = versionParts(a), y = versionParts(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
for (const release of releases) if (!release.draft && /^\d+\.\d+\.\d+$/.test(release.tag_name)) {
  assert.ok(compare(manifest.version, release.tag_name) >= 0, 'Manifest version would downgrade an existing release');
}
if (existing && !existing.draft) {
  assert.ok(!existing.prerelease, 'Existing version is a prerelease');
  const names = new Set(existing.assets.map(asset => asset.name));
  for (const name of ['main.js', 'manifest.json', 'styles.css']) assert.ok(names.has(name), `Existing release missing ${name}`);
  console.log(`Version ${manifest.version} already released; bump the manifest/package version to publish an update.`);
} else {
  const refs = JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/git/matching-refs/tags/${manifest.version}`]));
  const tag = refs.find(ref => ref.ref === `refs/tags/${manifest.version}`);
  if (tag) assert.ok(tag.object.type === 'commit' && tag.object.sha === process.env.GITHUB_SHA, 'Release tag points at a different commit');
  if (existing) {
    assert.equal(existing.target_commitish, process.env.GITHUB_SHA, 'Draft belongs to a different commit');
    gh(['release', 'upload', manifest.version, '--clobber', 'main.js', 'manifest.json', 'styles.css', 'release/writing-sessions.zip']);
  } else {
    // Draft first: a failed upload never exposes a partially populated release.
    gh(['release', 'create', manifest.version, '--target', process.env.GITHUB_SHA, '--draft', '--title', `Writing Sessions ${manifest.version}`, '--generate-notes', 'main.js', 'manifest.json', 'styles.css', 'release/writing-sessions.zip']);
  }
  gh(['release', 'edit', manifest.version, '--draft=false', '--latest']);
  console.log(`Published ${manifest.version} from ${process.env.GITHUB_SHA}`);
}
