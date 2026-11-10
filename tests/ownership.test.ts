import { afterEach, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, redo, isolateHistory } from '@codemirror/commands';
import { activeSession, applyCredit, initialData, parseData, sessionCounts, type Data } from '../src/model';
import { restoreOwnership, saveDocument } from '../src/ownership';
import { trackingExtension } from '../src/tracking';
const views: EditorView[] = [];
afterEach(() => { views.splice(0).forEach(view => view.destroy()); });
async function boot(files: Record<string, string>, saved: unknown = null) {
  const data = parseData(saved);
  if (!data.sessions.length) data.sessions.push({ id: 'session', startedAt: '2026-11-10T12:00:00Z', endedAt: null, days: {} });
  const keys = new Map(Object.keys(files).map(path => [path, { path }]));
  const initial = await restoreOwnership(data.ownership, async path => keys.has(path) ? { key: keys.get(path)!, text: files[path] } : undefined);
  const editors = new Map<string, EditorView>();
  const file = StateField.define<{ path: string }>({ create: () => ({ path: '' }), update: value => value });
  const tracking = trackingExtension(
    () => { const session = activeSession(data); return session && { sessionId: session.id, day: '2026-11-10' }; },
    credit => applyCredit(data, credit), state => state.field(file),
    { initial, commit: (key, snapshot) => {
      const path = (key as { path: string }).path;
      if (snapshot.marks.length) data.ownership[path] = saveDocument(snapshot); else delete data.ownership[path];
    } },
  );
  function reopen(path: string, text: string) {
    const previous = editors.get(path);
    if (previous) { previous.destroy(); views.splice(views.indexOf(previous), 1); }
    const key = keys.get(path)!;
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [file.init(() => key), history(), tracking] }) });
    views.push(view); editors.set(path, view);
    return view;
  }
  for (const path of keys.keys()) reopen(path, files[path]);
  return { data, editors, reopen, counts: () => sessionCounts(data.sessions[0]), saved: () => JSON.parse(JSON.stringify(data)) as Data };
}
it('restores credit after a real JSON save/load, including spelling edits with unchanged totals', async () => {
  const first = await boot({ 'Draft.md': 'older ' });
  const view = first.editors.get('Draft.md')!;
  view.dispatch({ changes: { from: 6, insert: 'new words' }, userEvent: 'input.type' });
  view.dispatch({ changes: { from: 6, to: 9, insert: 'fresh' }, userEvent: 'input.type' });
  expect(first.counts()).toEqual({ added: 2, net: 2 });
  const next = await boot({ 'Draft.md': view.state.doc.toString() }, first.saved());
  const reopened = next.editors.get('Draft.md')!;
  reopened.dispatch({ changes: { from: 0, to: reopened.state.doc.length }, userEvent: 'delete.backward' });
  expect(next.counts()).toEqual({ added: 0, net: -1 });
  undo(reopened); expect(next.counts().added).toBe(2);
  redo(reopened); expect(next.counts().added).toBe(0);
});
it('rejects changed or missing notes without changing saved totals', async () => {
  const first = await boot({ 'Draft.md': '' });
  first.editors.get('Draft.md')!.dispatch({ changes: { from: 0, insert: 'new words' }, userEvent: 'input.type' });
  const changed = await boot({ 'Draft.md': 'new word' }, first.saved());
  expect(changed.data.ownership).toEqual({});
  changed.editors.get('Draft.md')!.dispatch({ changes: { from: 0, to: 8 }, userEvent: 'delete.backward' });
  expect(changed.counts()).toEqual({ added: 2, net: 0 });
  const missing = await boot({}, first.saved());
  expect(missing.data.ownership).toEqual({}); expect(missing.counts().added).toBe(2);
});
it.each(['\n', '\r\n', '\r'])('restores unchanged editor text using its normalized line endings (%j)', async separator => {
  const first = await boot({ 'Draft.md': `older${separator}` });
  const view = first.editors.get('Draft.md')!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: 'new words' }, userEvent: 'input.type' });
  const text = view.state.doc.toString().replaceAll('\n', separator);
  const next = await boot({ 'Draft.md': text }, first.saved());
  const reopened = next.editors.get('Draft.md')!;
  reopened.dispatch({ changes: { from: 0, to: reopened.state.doc.length }, userEvent: 'delete.backward' });
  expect(next.counts()).toEqual({ added: 0, net: -1 });
});
it('preserves old data and rejects unsupported or invalid ownership data', () => {
  const legacy = { ...initialData(), version: 1 }; delete (legacy as Partial<Data>).ownership;
  expect(parseData(legacy)).toMatchObject({ version: 2, ownership: {} });
  expect(() => parseData({ ...initialData(), ownership: undefined })).toThrow();
  expect(() => parseData({ ...initialData(), ownership: { 'Draft.md': { digest: 'invalid', marks: [] } } })).toThrow();
});
it('does not store note contents in saved metadata', async () => {
  const first = await boot({ 'Draft.md': '' });
  first.editors.get('Draft.md')!.dispatch({ changes: { from: 0, insert: 'confidential writing sample' }, userEvent: 'input.type' });
  const serialized = JSON.stringify(first.saved());
  expect(serialized).not.toContain('confidential'); expect(serialized).toContain('Draft.md');
});

it('restores shared moved-word identities across notes without duplicate credit', async () => {
  const first = await boot({ 'A.md': '', 'B.md': '' });
  const a = first.editors.get('A.md')!, b = first.editors.get('B.md')!;
  a.dispatch({ changes: { from: 0, insert: 'two words' }, userEvent: 'input.type' });
  a.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete.cut', annotations: isolateHistory.of('full') });
  b.dispatch({ changes: { from: 0, insert: 'two words' }, userEvent: 'input.paste' });
  undo(a);
  expect(first.counts()).toEqual({ added: 2, net: 4 });
  const restarted = await boot({ 'A.md': a.state.doc.toString(), 'B.md': b.state.doc.toString() }, first.saved());
  restarted.editors.get('A.md')!.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete.backward' });
  expect(restarted.counts().added).toBe(2);
  restarted.editors.get('B.md')!.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete.backward' });
  expect(restarted.counts().added).toBe(0);
});
it('persists rejected reopened ownership even without editing that note', async () => {
  const first = await boot({ 'A.md': '', 'B.md': '' });
  const a = first.editors.get('A.md')!, b = first.editors.get('B.md')!;
  a.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.type' });
  a.dispatch({ changes: { from: 0, to: 5 }, userEvent: 'delete.cut', annotations: isolateHistory.of('full') });
  b.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
  undo(a);
  first.reopen('A.md', 'externally changed');
  b.dispatch({ changes: { from: 0, to: 5 }, userEvent: 'delete.backward' });
  expect(first.counts().added).toBe(0);
  const restarted = await boot({ 'A.md': 'draft', 'B.md': '' }, first.saved());
  restarted.editors.get('A.md')!.dispatch({ changes: { from: 0, to: 5 }, userEvent: 'delete.backward' });
  expect(restarted.counts().added).toBe(0);
});
