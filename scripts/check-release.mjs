import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function releaseMetadata() {
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const [manifest, pkg, versions] = await Promise.all(['manifest.json', 'package.json', 'versions.json'].map(read));
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(pkg.version, manifest.version, 'package and manifest versions must match');
  assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json must include the current minimum');
  for (const file of ['README.md', 'LICENSE', 'main.js', 'styles.css']) assert.ok((await readFile(file)).length, `${file} is empty`);
  return manifest;
}
if (process.argv[1]?.endsWith('/check-release.mjs')) {
  const manifest = await releaseMetadata();
  console.log(`Release metadata valid: ${manifest.id} ${manifest.version}`);
}
