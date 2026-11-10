// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const sha = 'a'.repeat(40);
const version = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
let releases = [];
beforeEach(() => {
  vi.resetModules(); releases = [];
  vi.stubEnv('GITHUB_REPOSITORY', 'ossianhempel/obsidian-writing-sessions');
  vi.stubEnv('GITHUB_EVENT_NAME', 'push'); vi.stubEnv('GITHUB_REF', 'refs/heads/main'); vi.stubEnv('GITHUB_SHA', sha);
  vi.mocked(execFileSync).mockImplementation((_bin, args) => {
    if (args?.includes('--slurp')) return JSON.stringify([releases]);
    if (args?.[0] === 'api') return '[]';
    return '';
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('publishes versioned assets to a draft first, then makes it public', async () => {
  await import('../scripts/release.mjs');
  const calls = vi.mocked(execFileSync).mock.calls.map(call => call[1]);
  expect(calls).toContainEqual(expect.arrayContaining(['release', 'create', version, '--target', sha, '--draft', 'main.js', 'manifest.json', 'styles.css']));
  expect(calls.at(-1)).toEqual(['release', 'edit', version, '--draft=false', '--latest']);
});
it('leaves an existing published version unchanged', async () => {
  releases = [{ tag_name: version, draft: false, prerelease: false, assets: ['main.js', 'manifest.json', 'styles.css'].map(name => ({ name })) }];
  await import('../scripts/release.mjs');
  expect(vi.mocked(execFileSync).mock.calls).toHaveLength(1);
});
it('resumes a draft only for the same commit', async () => {
  releases = [{ tag_name: version, draft: true, target_commitish: sha }];
  await import('../scripts/release.mjs');
  expect(vi.mocked(execFileSync).mock.calls.map(call => call[1])).toContainEqual(expect.arrayContaining(['release', 'upload', version, '--clobber']));
});
it('refuses a draft created from another commit', async () => {
  releases = [{ tag_name: version, draft: true, target_commitish: 'b'.repeat(40) }];
  await expect(import('../scripts/release.mjs')).rejects.toThrow('different commit');
  expect(vi.mocked(execFileSync).mock.calls.some(call => call[1]?.[0] === 'release')).toBe(false);
});
it('refuses publication from pull requests', async () => {
  vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
  await expect(import('../scripts/release.mjs')).rejects.toThrow();
  expect(execFileSync).not.toHaveBeenCalled();
});
