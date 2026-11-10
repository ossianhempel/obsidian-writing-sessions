import { ChangeSet, StateEffect, type ChangeDesc, type Text } from '@codemirror/state';
import type { WordMark } from './ownership';

type Token = object;
interface Step { changes: ChangeSet; remove: WordMark[]; restore: WordMark[] }
// Obsidian owns history grouping and eviction. Weak references let its
// retained receipt effects determine the lifetime of our inverse steps.
interface Entry { token?: WeakRef<Token>; step: Step }
export interface OwnershipHistory { done: Entry[]; undone: Entry[] }
export const historyReceipt = StateEffect.define<readonly Token[]>();
const same = (a: WordMark, b: WordMark) => a.id === b.id && a.from === b.from && a.to === b.to;
const overlap = (a: WordMark, b: WordMark) => a.from < b.to && b.from < a.to;
function mapped(marks: WordMark[], changes: ChangeDesc): WordMark[] {
  return marks.map(mark => ({ ...mark, from: changes.mapPos(mark.from, 1), to: changes.mapPos(mark.to, -1) })).filter(mark => mark.from < mark.to);
}
function inverseStep(changes: ChangeSet, doc: Text, before: WordMark[], after: WordMark[]): Step {
  const inverse = changes.invert(doc);
  const changed = (mark: WordMark, target: WordMark[], forward: ChangeDesc, backward: ChangeDesc) => {
    const next = mapped([mark], forward)[0];
    return !next || !target.some(other => same(other, next)) || !mapped([next], backward).some(other => same(mark, other));
  };
  return {
    changes: inverse,
    remove: mapped(after.filter(mark => changed(mark, before, inverse, changes)), inverse),
    restore: before.filter(mark => changed(mark, after, changes, inverse)),
  };
}
export function recordHistory(history: OwnershipHistory, token: Token, changes: ChangeSet, doc: Text, before: WordMark[], after: WordMark[]): OwnershipHistory {
  return { done: [...history.done.filter(entry => !entry.token || entry.token.deref()), { token: new WeakRef(token), step: inverseStep(changes, doc, before, after) }], undone: [] };
}
export function mapHistory(history: OwnershipHistory, mapping: ChangeDesc): OwnershipHistory {
  function branch(entries: Entry[]) {
    const live = entries.filter(entry => !entry.token || entry.token.deref());
    let through = mapping;
    for (let index = live.length - 1; index >= 0; index--) {
      const { token, step } = live[index];
      // Each receipt's marks use its inverse RESULT document. Carry the
      // mapping through that inverse before mapping the restoration data.
      if (through.length !== step.changes.length) throw new Error('Writing-session history mapping has incompatible documents');
      const before = through.mapDesc(step.changes, true);
      live[index] = { token, step: { changes: step.changes.map(through), remove: mapped(step.remove, before), restore: mapped(step.restore, before) } };
      through = before;
    }
    return live;
  }
  return { done: branch(history.done), undone: branch(history.undone) };
}
export function replayHistory(
  history: OwnershipHistory, receipts: readonly Token[], redo: boolean, doc: Text, marks: WordMark[],
  normalize: (doc: Text, marks: WordMark[]) => WordMark[],
): { history: OwnershipHistory; doc: Text; marks: WordMark[] } {
  const source = [...(redo ? history.undone : history.done)].filter(entry => !entry.token || entry.token.deref());
  const destination = [...(redo ? history.done : history.undone)].filter(entry => !entry.token || entry.token.deref());
  for (const token of receipts) {
    const entry = source.pop();
    if (entry?.token?.deref() !== token) throw new Error('Writing-session history is out of order');
    const step = entry.step;
    const nextDoc = step.changes.apply(doc);
    const surviving = mapped(marks, step.changes).filter(mark => !step.remove.some(old => same(mark, old) || mark.id === old.id && overlap(mark, old)));
    // Preserve unrelated mirrored origins before restoring captured origins.
    const nextMarks = normalize(nextDoc, [...surviving, ...step.restore]);
    destination.push({ token: new WeakRef(token), step: inverseStep(step.changes, doc, marks, nextMarks) });
    doc = nextDoc; marks = nextMarks;
  }
  return { history: redo ? { done: destination, undone: source } : { done: source, undone: destination }, doc, marks };
}

// History created before tracking has no receipts. Keep its intervening redo
// transitions as bridges so subsequent background mappings reach our receipts
// in the correct document, then discard each bridge when the host redoes it.
export function untrackedHistory(history: OwnershipHistory, changes: ChangeSet, doc: Text, redo: boolean): OwnershipHistory {
  const undone = [...history.undone];
  if (redo) {
    const last = undone.at(-1);
    if (last && !last.token) undone.pop();
  } else undone.push({ step: { changes: changes.invert(doc), remove: [], restore: [] } });
  return { done: history.done, undone };
}
