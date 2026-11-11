// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { map, root, waitVaultPage } from '../scripts/control-writing-sessions.mjs';
const scratch = [];
afterEach(async () => { for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'writing-sessions-map-')); scratch.push(dir);
  const features = path.join(dir, 'features');
  await cp(path.join(root, '.agents/skills/verify-writing-sessions/features'), features, { recursive: true });
  return { features, source: await readFile(path.join(root, 'src/main.ts'), 'utf8') };
}
describe('verification map drift checks', () => {
  it('rejects a newly added command without a mapped recipe', async () => {
    const options = await fixture(); options.source += '\nthis.addCommand({ id: "unmapped-command" });';
    await expect(map(true, options)).rejects.toThrow('Unmapped surface command:unmapped-command');
  });
  it('rejects a recipe naming a command that no longer exists', async () => {
    const options = await fixture(); const file = path.join(options.features, 'sessions.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('command:pause-session', 'command:removed-command'));
    await expect(map(true, options)).rejects.toThrow('cites missing surface command:removed-command');
  });
  it('rejects a feature absent from the index', async () => {
    const options = await fixture(); await writeFile(path.join(options.features, 'orphan.md'), '# Orphan');
    await expect(map(true, options)).rejects.toThrow('missing or orphaned');
  });
  it('rejects an index link whose feature file was removed', async () => {
    const options = await fixture(); await rm(path.join(options.features, 'goals.md'));
    await expect(map(true, options)).rejects.toThrow('missing or orphaned');
  });
});

describe('cold Electron startup readiness', () => {
  it('waits for a vault window that appears after the CDP connection', async () => {
    const page = { url: () => 'app://obsidian.md/index.html' };
    let available = false;
    const timer = setTimeout(() => { available = true; }, 20);
    try { expect(await waitVaultPage({ pages: () => available ? [page] : [] }, 500)).toBe(page); }
    finally { clearTimeout(timer); }
  });
  it('fails within a bounded time if no vault window appears', async () => {
    await expect(waitVaultPage({ pages: () => [{ url: () => 'about:blank' }] }, 20)).rejects.toThrow('readiness timeout');
  });
});
