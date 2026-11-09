import { expect, it, vi } from 'vitest';

it('replacement modules drain outgoing writes before loading and keep save order', async () => {
  const vault = {};
  const { writeQueue } = await import('../src/storage');
  const old = writeQueue(vault);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saved = 'initial';
  old.pending = old.pending.then(async () => { await gate; saved = 'first'; });
  old.pending = old.pending.then(() => { saved = 'latest'; });

  // Reload the module as Obsidian does when re-enabling a plugin.
  vi.resetModules();
  const replacement = await import('../src/storage');
  const next = replacement.writeQueue(vault);
  const observed = next.pending.then(() => saved);
  expect(saved).toBe('initial');
  release();
  expect(await observed).toBe('latest');
  next.pending = next.pending.then(() => { saved = 'new instance'; });
  await next.pending;
  expect(saved).toBe('new instance');
});
