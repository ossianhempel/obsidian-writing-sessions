import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, isolateHistory, undo, redo, insertNewline, copyLineDown } from '@codemirror/commands';
import { trackingExtension, wordCount } from '../src/tracking';
import { activeSession, applyCredit, dailyCounts, initialData, parseData, sessionCounts, writingDay, type Data } from '../src/model';

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });
function setup(doc = '') {
  let day = '2026-11-09';
  const data = initialData();
  data.sessions.push({ id: 'first', startedAt: '2026-11-09T12:00:00Z', endedAt: null, days: {} });
  function open(text = '') {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [history(), trackingExtension(() => {
      const session = activeSession(data);
      return session ? { sessionId: session.id, day } : undefined;
    }, credit => applyCredit(data, credit))] }) });
    views.push(view);
    return view;
  }
  const view = open(doc);
  function edit(insert: string, event = 'input.type', from = view.state.doc.length, to = from) {
    view.dispatch({ changes: { from, to, insert }, annotations: [Transaction.userEvent.of(event), isolateHistory.of('full')] });
  }
  return { data, view, open, edit, setDay: (value: string) => { day = value; }, counts: () => sessionCounts(data.sessions[0]) };
}

describe('writing credit through editor transactions and real undo history', () => {
  it('counts words, not keystrokes, and continues across pages', () => {
    const app = setup();
    for (const char of 'Hello world') app.edit(char);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'Another page' }, userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 4, net: 4 });
  });
  it('keeps writing credit after ordinary deletion', () => {
    const app = setup();
    app.edit('one two three');
    app.edit('', 'delete.backward', 4, 13);
    expect(app.counts()).toEqual({ added: 3, net: 1 });
  });
  it('excludes paste and drop from added credit; net remains document growth', () => {
    const app = setup();
    app.edit('one two', 'input.paste');
    app.edit(' three', 'input.drop');
    expect(app.counts()).toEqual({ added: 0, net: 3 });
    app.edit(' four');
    expect(app.counts()).toEqual({ added: 1, net: 4 });
  });
  it('cut and paste do not credit a word twice', () => {
    const app = setup();
    app.edit('one two');
    app.edit('', 'delete.cut', 0, 7);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'one two' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('undo reverses insertion credit and redo restores it', () => {
    const app = setup();
    app.edit('one two three');
    expect(undo(app.view)).toBe(true);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    expect(redo(app.view)).toBe(true);
    expect(app.counts()).toEqual({ added: 3, net: 3 });
  });
  it('undoing deletion does not invent writing credit', () => {
    const app = setup('old words');
    app.edit('', 'delete.backward', 0, 9);
    expect(app.counts()).toEqual({ added: 0, net: -2 });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('correctly reverses grouped, character-by-character typing', () => {
    const app = setup();
    for (const char of 'Hello world') app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: char }, userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('ignores programmatic changes and writing outside a session', () => {
    const app = setup();
    app.view.dispatch({ changes: { from: 0, insert: 'background import' } });
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.edit(' untracked typing');
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('undo targets the original session and day after rollover or session end', () => {
    const app = setup();
    app.edit('one two');
    app.setDay('2026-11-10');
    app.data.sessions[0].endedAt = '2026-11-10T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-10T14:00:00Z', endedAt: null, days: {} });
    undo(app.view);
    expect(dailyCounts(app.data, '2026-11-09')).toEqual({ added: 0, net: 0 });
    expect(dailyCounts(app.data, '2026-11-10')).toEqual({ added: 0, net: 0 });
    redo(app.view);
    expect(dailyCounts(app.data, '2026-11-09')).toEqual({ added: 2, net: 2 });
  });
  it('counts replacement text as new writing without counting spelling extensions', () => {
    const app = setup('old words');
    app.edit('new prose', 'input.type', 0, 9);
    expect(app.counts()).toEqual({ added: 2, net: 0 });
    app.edit('s');
    expect(app.counts()).toEqual({ added: 2, net: 0 });
  });
  it('credits a new word boundary when adding a missing space', () => {
    const app = setup();
    app.edit('helloworld');
    app.edit(' ', 'input.type', 5);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('does not credit each revision of an IME composition as a new word', () => {
    const app = setup();
    app.edit('k', 'input.type.compose');
    app.edit('ka', 'input.type.compose', 0, 1);
    app.edit('か', 'input.type.compose', 0, 2);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('credits an initial IME whole-word replacement but not candidate revisions', () => {
    const app = setup('old');
    app.edit('新', 'input.type.compose', 0, 3);
    app.edit('真', 'input.type.compose', 0, 1);
    expect(app.counts()).toEqual({ added: 1, net: 0 });
    // A new composition in the same word is a new writing action.
    app.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    app.edit('別', 'input.type.compose', 0, 1);
    expect(app.counts()).toEqual({ added: 2, net: 0 });
  });
  it('continues words beside supplementary-plane letters without extra credit', () => {
    const app = setup('𠮷');
    app.edit('野');
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    app.edit('新', 'input.type', 0);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    app.edit(' extra');
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('counts manual newline replacement in net change', () => {
    const app = setup('old words');
    app.view.dispatch({ selection: { anchor: 0, head: 9 } });
    insertNewline(app.view);
    expect(app.counts()).toEqual({ added: 0, net: -2 });
  });
  it('counts copied lines in net growth without adding writing credit', () => {
    const app = setup('old words');
    copyLineDown(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 2 });
  });
  it('does not let a deletion at another cursor cancel newly added words', () => {
    const app = setup('helloworld old');
    app.view.dispatch({ changes: [{ from: 5, insert: ' ' }, { from: 11, to: 14, insert: ' ' }], userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 1, net: 0 });
  });
  it('does not count the same words again when IME candidate sizes cycle', () => {
    const app = setup();
    app.edit('foo bar', 'input.type.compose');
    app.edit('foobar', 'input.type.compose', 0, 7);
    app.edit('foo bar', 'input.type.compose', 0, 6);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('foo bar baz', 'input.type.compose', 0, 7);
    expect(app.counts()).toEqual({ added: 3, net: 3 });
    app.edit('foobar', 'input.type.compose', 0, 11);
    app.edit('foo bar baz', 'input.type.compose', 0, 6);
    expect(app.counts()).toEqual({ added: 3, net: 3 });
    undo(app.view);
    redo(app.view);
    expect(app.counts()).toEqual({ added: 3, net: 3 });
  });
  it('preserves writing credit when another selection includes the separator', () => {
    const app = setup('helloworld old');
    app.view.dispatch({ changes: [{ from: 5, insert: ' ' }, { from: 10, to: 14, insert: ' ' }], userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 1, net: 0 });
  });
  it('does not double-count two edits that split the same word boundary', () => {
    const app = setup('a-b');
    app.view.dispatch({ changes: [{ from: 1, insert: ' ' }, { from: 2, insert: ' ' }], userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('credits a whole-word rewrite even when internal punctuation survives', () => {
    const app = setup('a-b');
    app.view.dispatch({ changes: [{ from: 0, to: 1, insert: 'x' }, { from: 2, to: 3, insert: 'y' }], userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 1, net: 0 });
  });
  it('handles simultaneous edits within the same word without duplicate net deltas', () => {
    const app = setup('hello');
    app.view.dispatch({ changes: [{ from: 1, insert: 'x' }, { from: 3, insert: 'y' }], userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
});

describe('writing day, totals, and saved data', () => {
  it('keeps after-midnight words on the previous day until 04:00', () => {
    expect(writingDay(new Date(2026, 10, 10, 0, 30))).toBe('2026-11-09');
    expect(writingDay(new Date(2026, 10, 10, 3, 59))).toBe('2026-11-09');
    expect(writingDay(new Date(2026, 10, 10, 4, 0))).toBe('2026-11-10');
    expect(writingDay(new Date(2027, 0, 1, 2))).toBe('2026-12-31');
  });
  it('uses local calendar days on daylight-saving transition days', () => {
    expect(writingDay(new Date(2026, 2, 29, 4))).toBe('2026-03-29');
    expect(writingDay(new Date(2026, 9, 25, 4))).toBe('2026-10-25');
  });
  it('adds sessions together and preserves the unfinished session on reload', () => {
    const data: Data = { version: 1, target: 100, mode: 'added', sessions: [
      { id: 'one', startedAt: '2026-11-09T12:00:00Z', endedAt: '2026-11-09T13:00:00Z', days: { '2026-11-09': { added: 60, net: 40 } } },
      { id: 'two', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: { '2026-11-09': { added: 50, net: -3 } } },
    ] };
    const reloaded = parseData(JSON.parse(JSON.stringify(data)));
    expect(dailyCounts(reloaded, '2026-11-09')).toEqual({ added: 110, net: 37 });
    expect(activeSession(reloaded)?.id).toBe('two');
  });
  it('fails on invalid saved data instead of overwriting it with defaults', () => {
    expect(() => parseData({ version: 99 })).toThrow();
    expect(() => parseData({ ...initialData(), target: -1 })).toThrow();
    expect(parseData(null).target).toBe(100);
  });
  it('counts letters and numbers, including Swedish words, not Markdown symbols', () => {
    expect(wordCount('# Hello, världen! **A** well-written writer’s 100 words.')).toBe(7);
    expect(wordCount('--- ** [] 🙂')).toBe(0);
  });
});
