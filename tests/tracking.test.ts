import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, isolateHistory, undo, redo, insertNewline, copyLineDown, moveLineUp, moveLineDown, transposeChars } from '@codemirror/commands';
import { trackingExtension, wordCount } from '../src/tracking';
import { activeSession, countingSession, applyCredit, dailyCounts, endExpiredSession, initialData, parseData, sessionCounts, writingDay, type Data } from '../src/model';

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });
function setup(doc = '') {
  let day = '2026-11-09';
  const data = initialData();
  data.sessions.push({ id: 'first', startedAt: '2026-11-09T12:00:00Z', endedAt: null, days: {} });
  const fileChanged = StateEffect.define<object>();
  const file = StateField.define<object>({ create: () => ({}), update: (value, transaction) => transaction.effects.find(effect => effect.is(fileChanged))?.value ?? value });
  const tracking = trackingExtension(() => {
    const session = countingSession(data);
    return session ? { sessionId: session.id, day } : undefined;
  }, credit => applyCredit(data, credit), state => state.field(file));
  function open(text = '', key: object = {}) {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: text, extensions: [file.init(() => key), history(), tracking] }) });
    views.push(view);
    return view;
  }
  const view = open(doc);
  function edit(insert: string, event = 'input.type', from = view.state.doc.length, to = from) {
    view.dispatch({ changes: { from, to, insert }, annotations: [Transaction.userEvent.of(event), isolateHistory.of('full')] });
  }
  return { data, view, open, edit, file, fileChanged, setDay: (value: string) => { day = value; endExpiredSession(data, new Date(`${value}T04:00:00`)); }, counts: () => sessionCounts(data.sessions[0]) };
}

describe('writing credit through editor transactions and real undo history', () => {
  it('ignores paused typing and resumes counting within the same session', () => {
    const app = setup();
    app.edit('counted words');
    app.data.sessions[0].paused = true;
    app.edit(' ignored words');
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.data.sessions[0].paused = false;
    app.edit(' resumed words');
    expect(app.counts()).toEqual({ added: 4, net: 4 });
    expect(app.data.sessions).toHaveLength(1);
    app.edit('', 'delete.backward', 14, 27);
    expect(app.counts()).toEqual({ added: 4, net: 2 });
  });
  it('keeps undo and redo credit tied to edits across pause boundaries', () => {
    const app = setup();
    app.edit('counted words');
    app.data.sessions[0].paused = true;
    app.edit(' ignored words');
    undo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.data.sessions[0].paused = false;
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('counts words, not keystrokes, and continues across pages', () => {
    const app = setup();
    for (const char of 'Hello world') app.edit(char);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'Another page' }, userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 4, net: 4 });
  });
  it('subtracts session words after ordinary deletion', () => {
    const app = setup();
    app.edit('one two three');
    app.edit('', 'delete.backward', 4, 13);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('subtracts only session words from a selection containing older text', () => {
    const app = setup('older words ');
    app.edit('new words');
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts()).toEqual({ added: 0, net: -2 });
  });
  it('keeps partial words credited until their last letter is removed', () => {
    const app = setup();
    app.edit('hello');
    app.edit('', 'delete.backward', 2, 5);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    app.edit('', 'delete.backward', 0, 2);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('does not inflate the count when rewriting a session word', () => {
    const app = setup();
    app.edit('first draft');
    app.edit('better', 'input.type', 0, 5);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('undoes and redoes deletion of session words without losing their origin', () => {
    const app = setup('old ');
    app.edit('new words');
    app.edit('', 'delete.backward', 4, 13);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    redo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('does not subtract words credited to a previous session', () => {
    const app = setup();
    app.edit('previous session');
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    app.edit(' current words');
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    expect(sessionCounts(app.data.sessions[1])).toEqual({ added: 0, net: -2 });
  });
  it('preserves previous-session credit when replaying a later session deletion', () => {
    const app = setup();
    app.edit('earlier words');
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    app.edit('', 'delete.backward', 0, 13);
    undo(app.view);
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    expect(sessionCounts(app.data.sessions[1])).toEqual({ added: 0, net: -2 });
  });
  it('keeps rapid edits from different sessions in separate undo groups', () => {
    const app = setup();
    app.view.dispatch({ changes: { from: 0, insert: 'earlier words' }, userEvent: 'input.type' });
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    app.view.dispatch({ changes: { from: 0, to: 13 }, userEvent: 'delete.backward' });
    undo(app.view);
    expect(app.view.state.doc.toString()).toBe('earlier words');
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    expect(sessionCounts(app.data.sessions[1])).toEqual({ added: 0, net: -2 });
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
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'one two' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    second.dispatch({ changes: { from: 7, insert: ' one two' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 4 });
    second.dispatch({ changes: { from: 0, to: 7 }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 0, net: 2 });
  });
  it('does not transfer credit if the cut was undone before pasting', () => {
    const app = setup();
    app.edit('new words');
    app.edit('', 'delete.cut', 0, 9);
    undo(app.view);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'new words' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 4 });
  });
  it('does not duplicate credit when undoing a cut after pasting into another note', () => {
    const app = setup();
    app.edit('new words');
    app.edit('', 'delete.cut', 0, 9);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'new words' }, userEvent: 'input.paste' });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 4 });
    second.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('', 'delete.backward', 0, 9);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('does not assign cut credit to a subsequent copy', () => {
    const app = setup();
    app.edit('new words');
    app.edit('', 'delete.cut', 0, 9);
    app.view.contentDOM.dispatchEvent(new Event('copy', { bubbles: true }));
    app.edit('new words', 'input.paste');
    expect(app.counts()).toEqual({ added: 0, net: 2 });
  });
  it('keeps one identity when rewriting a moved word after undoing its source cut', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    second.dispatch({ changes: { from: 0, to: 5, insert: 'better' }, userEvent: 'input.type' });
    expect(app.counts()).toEqual({ added: 1, net: 2 });
    undo(second); expect(app.counts().added).toBe(1);
    redo(second); expect(app.counts().added).toBe(1);
  });
  it('keeps surviving older identities when another session edits a moved word', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    second.dispatch({ changes: { from: 5, insert: '.' }, userEvent: 'input.type' });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    expect(sessionCounts(app.data.sessions[1])).toEqual({ added: 0, net: 0 });
  });
  it('retains a pending cut across unrelated undo and redo', () => {
    const app = setup();
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'other ' }, userEvent: 'input.type' });
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    undo(second); redo(second);
    second.dispatch({ changes: { from: 6, insert: 'draft' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('restores a cut transfer when redoing the source cut with unchanged clipboard provenance', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    undo(app.view); redo(app.view);
    app.edit('draft', 'input.paste');
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('allows moving a cut again after undoing the destination paste', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(second);
    app.open().dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('does not restore an obsolete cut receipt after copying and undoing a paste', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    second.contentDOM.dispatchEvent(new Event('copy', { bubbles: true }));
    undo(second);
    app.edit('draft', 'input.paste');
    expect(app.counts()).toEqual({ added: 0, net: 1 });
  });
  it('keeps a source cut undone when its destination paste is also undone', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    undo(second);
    app.open().dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    app.edit('', 'delete.backward', 0, 5);
    expect(app.counts()).toEqual({ added: 0, net: 1 });
  });
  it.each(['draft', 'draft\n'])('transfers linewise clipboard credit through real editor events (%j)', text => {
    const app = setup();
    app.edit(text);
    const clipboard = new Map<string, string>();
    const event = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        clearData: () => clipboard.clear(),
        setData: (type: string, value: string) => clipboard.set(type, value),
        getData: (type: string) => clipboard.get(type) ?? '',
      } });
      return event;
    };
    app.view.dispatch({ selection: { anchor: 0 } });
    app.view.focus();
    app.view.contentDOM.dispatchEvent(event('cut'));
    expect(app.view.state.doc.toString()).toBe('');
    const second = app.open();
    second.focus();
    second.contentDOM.dispatchEvent(event('paste'));
    expect(second.state.doc.toString()).toBe('draft\n');
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    undo(second);
    const third = app.open();
    third.focus();
    third.contentDOM.dispatchEvent(event('paste'));
    expect(third.state.doc.toString()).toBe('draft\n');
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('prefers baseline origins across the whole pasted phrase', () => {
    const app = setup();
    app.edit('two');
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    app.edit('one ', 'input.type', 0);
    app.edit('', 'delete.cut', 0, 7);
    const destination = app.open('ab');
    destination.dispatch({ changes: { from: 1, insert: 'one two' }, userEvent: 'input.paste' });
    expect(destination.state.doc.toString()).toBe('aone twob');
    expect(sessionCounts(app.data.sessions[1]).added).toBe(0);
  });
  it('transfers a non-final linewise cut over a destination selection', () => {
    const app = setup();
    app.edit('draft\nkeep');
    const clipboard = new Map<string, string>();
    const event = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        clearData: () => clipboard.clear(),
        setData: (type: string, value: string) => clipboard.set(type, value),
        getData: (type: string) => clipboard.get(type) ?? '',
      } });
      return event;
    };
    app.view.dispatch({ selection: { anchor: 0 } }); app.view.focus();
    app.view.contentDOM.dispatchEvent(event('cut'));
    expect(app.view.state.doc.toString()).toBe('keep');
    const destination = app.open('old');
    destination.dispatch({ selection: { anchor: 0, head: 3 } }); destination.focus();
    destination.contentDOM.dispatchEvent(event('paste'));
    expect(destination.state.doc.toString()).toBe('draft');
    expect(app.counts().added).toBe(2);
    destination.dispatch({ changes: { from: 0, to: 5 }, userEvent: 'delete.backward' });
    expect(app.counts().added).toBe(1);
  });
  it('retains older shared ownership when a later session cuts it into another note', () => {
    const app = setup();
    app.edit('draft');
    app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    app.data.sessions[0].endedAt = '2026-11-09T13:00:00Z';
    app.data.sessions.push({ id: 'second', startedAt: '2026-11-09T14:00:00Z', endedAt: null, days: {} });
    second.dispatch({ changes: { from: 0, to: 5 }, userEvent: 'delete.cut' });
    app.open().dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    expect(sessionCounts(app.data.sessions[1])).toEqual({ added: 0, net: 0 });
  });
  it.each([false, true])('preserves a cut phrase pasted inside another word (destination is session writing: %s)', active => {
    const app = setup();
    app.edit('one two');
    const second = app.open(active ? '' : 'ab');
    if (active) second.dispatch({ changes: { from: 0, insert: 'ab' }, userEvent: 'input.type' });
    app.edit('', 'delete.cut', 0, 7);
    second.dispatch({ changes: { from: 1, insert: 'one two' }, userEvent: 'input.paste' });
    expect(second.state.doc.toString()).toBe('aone twob');
    const expected = active ? 2 : 1;
    expect(app.counts()).toEqual({ added: expected, net: expected });
    second.dispatch({ changes: { from: 0, to: second.state.doc.length }, userEvent: 'delete.backward', annotations: isolateHistory.of('full') });
    expect(app.counts().added).toBe(0);
    undo(second);
    expect(second.state.doc.toString()).toBe('aone twob');
    expect(app.counts().added).toBe(expected);
    redo(second); expect(app.counts().added).toBe(0);
  });
  it.each(['one ', ' one'])('preserves cut and destination identities when a paste splits a word (%j)', text => {
    const app = setup();
    app.edit(text);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'ab' }, userEvent: 'input.type' });
    app.edit('', 'delete.cut', 0, text.length);
    second.dispatch({ changes: { from: 1, insert: text }, userEvent: 'input.paste' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    second.dispatch({ changes: { from: 0, to: second.state.doc.length }, userEvent: 'delete.backward', annotations: isolateHistory.of('full') });
    expect(app.counts().added).toBe(0);
    undo(second); expect(app.counts().added).toBe(2);
  });
  it('preserves credit through a manual move transaction', () => {
    const app = setup('old text\n');
    app.edit('new words\n');
    app.view.dispatch({ changes: [{ from: 0, insert: 'new words\n' }, { from: 9, to: 19 }], userEvent: 'move.line' });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('', 'delete.backward', 0, 10);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('preserves credit through the actual editor move-line commands', () => {
    const app = setup('older line\n');
    app.edit('new words');
    app.view.dispatch({ selection: { anchor: 1 } });
    expect(moveLineDown(app.view)).toBe(true);
    expect(app.view.state.doc.toString()).toBe('new words\nolder line');
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    expect(moveLineUp(app.view)).toBe(true);
    expect(app.view.state.doc.toString()).toBe('older line\nnew words');
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('', 'delete.backward', 11, 20);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('preserves credit through the actual editor transpose-characters command', () => {
    const app = setup();
    app.edit('no');
    app.view.dispatch({ selection: { anchor: 1 } });
    expect(transposeChars(app.view)).toBe(true);
    expect(app.view.state.doc.toString()).toBe('on');
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    app.edit('', 'delete.backward', 0, 2);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('keeps older-word provenance when transposition joins old and session words', () => {
    const app = setup(' b');
    app.edit('a', 'input.type', 0);
    app.view.dispatch({ selection: { anchor: 2 } });
    transposeChars(app.view);
    expect(app.view.state.doc.toString()).toBe('ab ');
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('merges and splits session words without accumulating credit', () => {
    const app = setup();
    app.edit('one two');
    app.edit('', 'delete.backward', 3, 4);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
    app.edit(' ', 'input.type', 3);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
  });
  it('does not reduce session credit when deleting a pasted word', () => {
    const app = setup();
    app.edit('mine ');
    app.edit('pasted text', 'input.paste');
    app.edit('', 'delete.backward', 5, 16);
    expect(app.counts()).toEqual({ added: 1, net: 1 });
  });
  it('stops credit at 04:00 and leaves prior-session words unchanged by later deletion', () => {
    const app = setup();
    app.edit('before cutoff');
    app.setDay('2026-11-10');
    app.edit(' after');
    app.edit('', 'delete.backward', 0, 14);
    expect(activeSession(app.data)).toBeUndefined();
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    expect(dailyCounts(app.data, '2026-11-09')).toEqual({ added: 2, net: 2 });
    expect(dailyCounts(app.data, '2026-11-10')).toEqual({ added: 0, net: 0 });
    undo(app.view);
    expect(dailyCounts(app.data, '2026-11-09').added).toBe(2);
  });
  it('remembers session-word origins when a note is closed and reopened', () => {
    const app = setup('older ');
    app.edit('new words');
    const key = app.view.state.field(app.file);
    const doc = app.view.state.doc.toString();
    app.view.destroy();
    const reopened = app.open(doc, key);
    reopened.dispatch({ changes: { from: 0, to: doc.length }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 0, net: -1 });
  });
  it('does not apply saved word origins to an externally changed document', () => {
    const app = setup();
    app.edit('new words');
    const changed = app.open('different text', app.view.state.field(app.file));
    changed.dispatch({ changes: { from: 0, to: 14 }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 2, net: 0 });
  });
  it('does not revive rejected origins when an external edit is later reversed by typing', () => {
    const app = setup();
    app.edit('new words');
    const changed = app.open('new word', app.view.state.field(app.file));
    changed.dispatch({ changes: { from: 8, insert: 's' }, userEvent: 'input.type' });
    changed.dispatch({ changes: { from: 0, to: 9 }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 2, net: 0 });
  });
  it('treats externally changed text as baseline after a metadata-only return to a note', () => {
    const app = setup();
    const firstFile = app.view.state.field(app.file);
    app.edit('new words');
    app.view.dispatch({ effects: app.fileChanged.of({}) });
    app.view.dispatch({ changes: { from: 0, to: 9, insert: 'new word' }, annotations: Transaction.addToHistory.of(false) });
    app.view.dispatch({ effects: app.fileChanged.of(firstFile) });
    app.edit('s');
    app.edit('', 'delete.backward', 0, 9);
    expect(app.counts()).toEqual({ added: 2, net: 0 });
  });
  it('removes rejected shared ownership on a completed switch without a text change', () => {
    const app = setup();
    const a = app.view.state.field(app.file);
    app.edit('draft'); app.edit('', 'delete.cut', 0, 5);
    const second = app.open();
    second.dispatch({ changes: { from: 0, insert: 'draft' }, userEvent: 'input.paste' });
    undo(app.view);
    second.dispatch({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' });
    const b = app.open('draft!', second.state.field(app.file));
    second.dispatch({ effects: app.fileChanged.of(a) });
    // The switched note is externally changed to the already displayed text.
    app.view.destroy(); views.splice(views.indexOf(app.view), 1);
    b.dispatch({ changes: { from: 0, to: 6 }, userEvent: 'delete.backward' });
    expect(app.counts().added).toBe(0);
  });
  it('shares word origins with a second pane without counting its mirrored edit twice', () => {
    const app = setup('old ');
    const pane = app.open('old ', app.view.state.field(app.file));
    app.edit('new words');
    pane.dispatch({ changes: { from: 4, insert: 'new words' } });
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    pane.dispatch({ changes: { from: 4, to: 13 }, userEvent: 'delete.backward' });
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('restores word origins when one editor switches away from and back to a note', () => {
    const app = setup();
    const firstFile = app.view.state.field(app.file);
    app.edit('my words');
    app.view.dispatch({ effects: app.fileChanged.of({}) });
    app.view.dispatch({ changes: { from: 0, to: 8, insert: 'older content' }, annotations: Transaction.addToHistory.of(false) });
    app.view.dispatch({ effects: app.fileChanged.of(firstFile) });
    app.view.dispatch({ changes: { from: 0, to: 13, insert: 'my words' }, annotations: Transaction.addToHistory.of(false) });
    app.edit('', 'delete.backward', 0, 8);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it.each([false, true])('restores origins between identical notes (replacement load: %s)', replace => {
    const app = setup();
    const firstFile = app.view.state.field(app.file);
    app.edit('mine');
    app.view.dispatch({ effects: app.fileChanged.of({}) });
    app.view.dispatch({ changes: replace ? { from: 0, to: 4, insert: 'mine' } : undefined, annotations: Transaction.addToHistory.of(false) });
    app.view.dispatch({ effects: app.fileChanged.of(firstFile) });
    app.view.dispatch({ changes: replace ? { from: 0, to: 4, insert: 'mine' } : undefined, annotations: Transaction.addToHistory.of(false) });
    app.edit('', 'delete.backward', 0, 4);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
  });
  it('still credits manually rewriting baseline words with identical text', () => {
    const app = setup('old');
    app.view.dispatch({ changes: { from: 0, to: 3, insert: 'old' }, annotations: Transaction.addToHistory.of(false) });
    app.edit('old', 'input.type', 0, 3);
    expect(app.counts()).toEqual({ added: 1, net: 0 });
    app.edit('', 'delete.backward', 0, 3);
    expect(app.counts()).toEqual({ added: 0, net: -1 });
  });
  it('keeps one receipt when a host filter rebuilds an already extended transaction', () => {
    const app = setup();
    app.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of(transaction => ({
      changes: transaction.changes, selection: transaction.selection, effects: transaction.effects,
      annotations: [Transaction.userEvent.of(transaction.annotation(Transaction.userEvent) ?? ''),
        Transaction.addToHistory.of(transaction.annotation(Transaction.addToHistory) ?? true),
        ...(transaction.annotation(isolateHistory) ? [isolateHistory.of(transaction.annotation(isolateHistory)!)] : [])],
    }))) });
    app.edit('one two');
    app.edit('', 'delete.backward', 0, 7);
    expect(app.counts().added).toBe(0);
    expect(() => undo(app.view)).not.toThrow();
    expect(app.view.state.doc.toString()).toBe('one two'); expect(app.counts().added).toBe(2);
    redo(app.view); expect(app.view.state.doc.toString()).toBe(''); expect(app.counts().added).toBe(0);
  });
  it('records a history-eligible document load that also switches file metadata', () => {
    const app = setup(); app.edit('one two');
    app.view.dispatch({ changes: { from: 0, to: 7, insert: 'older' }, effects: app.fileChanged.of({}), annotations: isolateHistory.of('full') });
    expect(() => undo(app.view)).not.toThrow();
    expect(app.view.state.doc.toString()).toBe('one two');
  });
  it('rebases deletion receipts through background changes without invalid positions', () => {
    const app = setup();
    app.edit('one two'); app.edit('', 'delete.backward', 0, 7);
    expect(() => app.view.dispatch({ changes: { from: 0, insert: 'old ' }, annotations: Transaction.addToHistory.of(false) })).not.toThrow();
    undo(app.view);
    expect(app.view.state.doc.toString()).toBe('old one two');
    expect(app.counts().added).toBe(2);
    redo(app.view); expect(app.counts().added).toBe(0);
    undo(app.view);
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts().added).toBe(0);
  });
  it.each([0, 4])('preserves a mirrored word while undoing and redoing neighboring writing (position %s)', position => {
    const app = setup();
    app.edit('one five');
    const pane = app.open('one five', app.view.state.field(app.file));
    pane.dispatch({ changes: { from: position, insert: 'two ' }, userEvent: 'input.type' });
    app.view.dispatch({ changes: { from: position, insert: 'two ' }, annotations: Transaction.addToHistory.of(false) });
    expect(app.counts().added).toBe(3);
    undo(app.view);
    expect(app.view.state.doc.toString()).toBe('two ');
    expect(app.counts().added).toBe(1);
    redo(app.view);
    expect(app.counts().added).toBe(3);
    undo(app.view);
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts().added).toBe(0);
  });
  it('replays grouped replacements through remapping on both history branches', () => {
    const app = setup();
    app.edit('same same');
    app.view.dispatch({ changes: { from: 0, to: 4, insert: 'new' }, userEvent: 'input.type', annotations: isolateHistory.of('before') });
    app.view.dispatch({ changes: { from: 0, to: 3, insert: 'fresh' }, userEvent: 'input.type' });
    app.view.dispatch({ changes: { from: 0, insert: 'older ' }, annotations: Transaction.addToHistory.of(false) });
    undo(app.view);
    expect(app.view.state.doc.toString()).toBe('older same same');
    expect(app.counts().added).toBe(2);
    app.view.dispatch({ changes: { from: 0, to: 5, insert: 'prior' }, annotations: Transaction.addToHistory.of(false) });
    redo(app.view);
    expect(app.view.state.doc.toString()).toBe('prior fresh same');
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts().added).toBe(0);
  });
  it('allows undoing editor history from before the plugin was loaded', () => {
    const state = EditorState.create({ doc: '', extensions: [history()] });
    const typed = state.update({ changes: { from: 0, insert: 'older' }, userEvent: 'input.type' }).state;
    const view = new EditorView({ parent: document.body, state: typed }); views.push(view);
    view.dispatch({ effects: StateEffect.appendConfig.of(trackingExtension(() => ({ sessionId: 's', day: '2026-11-09' }), () => {})) });
    expect(() => undo(view)).not.toThrow();
    expect(view.state.doc.toString()).toBe('');
  });
  it('isolates the first tracked typing from adjacent pre-plugin history', () => {
    const before = EditorState.create({ extensions: [history()] }).update({ changes: { from: 0, insert: 'older' }, userEvent: 'input.type' }).state;
    const view = new EditorView({ parent: document.body, state: before }); views.push(view);
    view.dispatch({ effects: StateEffect.appendConfig.of(trackingExtension(() => ({ sessionId: 's', day: '2026-11-09' }), () => {})) });
    view.dispatch({ changes: { from: 5, insert: ' new' }, userEvent: 'input.type' });
    expect(() => undo(view)).not.toThrow();
    expect(view.state.doc.toString()).toBe('older');
  });
  it('rebases tracked redo past receiptless undo and redo', () => {
    const before = EditorState.create({ extensions: [history()] }).update({ changes: { from: 0, insert: 'older' }, userEvent: 'input.type' }).state;
    const view = new EditorView({ parent: document.body, state: before }); views.push(view);
    view.dispatch({ effects: StateEffect.appendConfig.of(trackingExtension(() => ({ sessionId: 's', day: '2026-11-09' }), () => {})) });
    view.dispatch({ changes: { from: 5, insert: ' new' }, userEvent: 'input.type', annotations: isolateHistory.of('full') });
    undo(view); undo(view); expect(view.state.doc.toString()).toBe('');
    expect(() => view.dispatch({ changes: { from: 0, insert: 'baseline ' }, annotations: Transaction.addToHistory.of(false) })).not.toThrow();
    redo(view); expect(view.state.doc.toString()).toBe('baseline older');
    redo(view); expect(view.state.doc.toString()).toBe('baseline older new');
    undo(view); expect(view.state.doc.toString()).toBe('baseline older');
  });
  it('preserves pending note ownership through selection-only updates before loading', () => {
    const app = setup(); const key = app.view.state.field(app.file);
    app.edit('my words');
    app.view.dispatch({ effects: app.fileChanged.of({}) });
    app.view.dispatch({ changes: { from: 0, to: 8, insert: 'older' }, annotations: Transaction.addToHistory.of(false) });
    app.view.dispatch({ effects: app.fileChanged.of(key) });
    app.view.dispatch({ selection: { anchor: 2 } });
    app.view.dispatch({ changes: { from: 0, to: 5, insert: 'my words' }, annotations: Transaction.addToHistory.of(false) });
    app.edit('', 'delete.backward', 0, 8);
    expect(app.counts().added).toBe(0);
  });
  it('reverses original credit even when background edits removed an eligible word', () => {
    const app = setup(); app.edit('one two');
    app.view.dispatch({ changes: { from: 3, to: 7 }, annotations: Transaction.addToHistory.of(false) });
    expect(app.counts().added).toBe(2);
    undo(app.view); expect(app.view.state.doc.toString()).toBe(''); expect(app.counts().added).toBe(0);
    redo(app.view); expect(app.view.state.doc.toString()).toBe('one'); expect(app.counts().added).toBe(2);
  });
  it('retains attribution after undo history is remapped by a background insertion', () => {
    const app = setup();
    app.edit('new words');
    app.view.dispatch({ changes: { from: 0, insert: 'old ' }, annotations: Transaction.addToHistory.of(false) });
    undo(app.view);
    expect(app.counts()).toEqual({ added: 0, net: 0 });
    redo(app.view);
    expect(app.counts()).toEqual({ added: 2, net: 2 });
    app.edit('', 'delete.backward', 0, app.view.state.doc.length);
    expect(app.counts()).toEqual({ added: 0, net: -1 });
  });
  it('keeps the retained count equal to the remaining words through varied edits and undo/redo', () => {
    const app = setup();
    let seed = 1947;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const inserts = ['a', ' ', '-', '🙂', 'two words', '\n', 'ö', "'", '𠮷'];
    for (let step = 0; step < 1000; step++) {
      const length = app.view.state.doc.length;
      const from = random(length + 1), to = from + random(length - from + 1);
      const previous = app.view.state.doc.toString();
      const insert = inserts[random(inserts.length)];
      app.edit(insert, 'input.type', from, to);
      expect(app.counts(), `edit ${step}: ${JSON.stringify({ previous, from, to, insert, after: app.view.state.doc.toString() })}`).toEqual({ added: wordCount(app.view.state.doc.toString()), net: wordCount(app.view.state.doc.toString()) });
      if (step % 7 === 0) {
        undo(app.view);
        expect(app.counts(), `undo ${step}`).toEqual({ added: wordCount(app.view.state.doc.toString()), net: wordCount(app.view.state.doc.toString()) });
        redo(app.view);
        expect(app.counts(), `redo ${step}`).toEqual({ added: wordCount(app.view.state.doc.toString()), net: wordCount(app.view.state.doc.toString()) });
      }
    }
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
    // A fresh composition rewrites the same retained word without inflating it.
    app.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    app.edit('別', 'input.type.compose', 0, 1);
    expect(app.counts()).toEqual({ added: 1, net: 0 });
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
    const data: Data = { ...initialData(), sessions: [
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
