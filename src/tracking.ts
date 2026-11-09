import { EditorState, StateEffect, StateField, type Extension, Transaction, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { invertedEffects } from '@codemirror/commands';
import type { Credit } from './model';

// Letters/numbers with internal apostrophes or hyphens form a word. Markdown
// punctuation and standalone symbols do not. No note text is persisted.
const words = () => /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
export function wordCount(text: string): number { return [...text.matchAll(words())].length; }

function wordCharacter(char: string): boolean { return /[\p{L}\p{N}'’\-]/u.test(char); }
function context(doc: Text, from: number, to: number): [number, number] {
  while (from > 0) {
    let previous = from - 1;
    const unit = doc.sliceString(previous, from).charCodeAt(0);
    if (unit >= 0xdc00 && unit <= 0xdfff && previous > 0) previous--;
    if (!wordCharacter(doc.sliceString(previous, from))) break;
    from = previous;
  }
  while (to < doc.length) {
    const point = doc.sliceString(to, Math.min(to + 2, doc.length)).codePointAt(0)!;
    if (!wordCharacter(String.fromCodePoint(point))) break;
    to += point > 0xffff ? 2 : 1;
  }
  return [from, to];
}

export function transactionCounts(transaction: Transaction, countAdded = true): { added: number; net: number } {
  let added = 0;
  let net = 0;
  const ranges: { a: number; z: number; b: number; y: number }[] = [];
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const [a, z] = context(transaction.startState.doc, fromA, toA);
    const [b, y] = context(transaction.newDoc, fromB, toB);
    const last = ranges.at(-1);
    if (last && (a <= last.z || b <= last.y)) { last.z = z; last.y = y; }
    else ranges.push({ a, z, b, y });
  });
  const gaps: { old: number; current: number; length: number }[] = [];
  if (countAdded) transaction.changes.iterGaps((old, current, length) => gaps.push({ old, current, length }));
  for (const range of ranges) {
    const before = [...transaction.startState.doc.sliceString(range.a, range.z).matchAll(words())];
    const after = [...transaction.newDoc.sliceString(range.b, range.y).matchAll(words())];
    net += after.length - before.length;
    if (!countAdded) continue;

    // Follow surviving letters through unchanged spans. A new token with no
    // surviving source word is new writing. Splitting a source word into N
    // tokens earns N-1 words. Deleting another word cannot cancel either credit.
    const descendants = before.map(() => 0);
    for (const token of after) {
      const start = range.b + token.index;
      const end = start + token[0].length;
      const sources = new Set<number>();
      for (const gap of gaps) {
        const from = Math.max(start, gap.current);
        const to = Math.min(end, gap.current + gap.length);
        if (from >= to) continue;
        const oldFrom = gap.old + from - gap.current;
        const oldTo = gap.old + to - gap.current;
        for (let index = 0; index < before.length; index++) {
          const source = before[index];
          const a = Math.max(oldFrom, range.a + source.index);
          const z = Math.min(oldTo, range.a + source.index + source[0].length);
          if (a < z && /[\p{L}\p{N}]/u.test(transaction.startState.doc.sliceString(a, z))) sources.add(index);
        }
      }
      if (!sources.size) added++;
      else for (const source of sources) descendants[source]++;
    }
    added += descendants.reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  }
  return { added, net };
}

export const creditEffect = StateEffect.define<Credit>();
const compositionStarted = StateEffect.define<null>();
const composing = StateField.define<{ current: number; highWater: number } | null>({
  create: () => null,
  update: (value, transaction) => {
    if (transaction.effects.some(effect => effect.is(compositionStarted))) return null;
    if (transaction.isUserEvent('input.type.compose')) {
      const counts = transactionCounts(transaction);
      const current = value ? value.current + counts.net : counts.added;
      return { current, highWater: Math.max(value?.highWater ?? 0, current) };
    }
    return transaction.docChanged ? null : value;
  },
});
export function trackingExtension(
  current: () => { sessionId: string; day: string } | undefined,
  receive: (credit: Credit) => void,
): Extension {
  return [
    composing,
    EditorView.domEventHandlers({
      // Reset at the start rather than the end: some input methods commit their
      // final candidate after compositionend. That candidate is still a revision.
      compositionstart: (_event, view) => { view.dispatch({ effects: compositionStarted.of(null) }); },
    }),
    EditorState.transactionExtender.of(transaction => {
      if (!transaction.docChanged || transaction.effects.some(effect => effect.is(creditEffect))) return null;
      const session = current();
      if (!session || transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) return null;
      const typing = transaction.isUserEvent('input.type') || transaction.annotation(Transaction.userEvent) === 'input';
      const direct = transaction.isUserEvent('input') || transaction.isUserEvent('delete') || transaction.isUserEvent('move');
      if (!direct) return null;
      const counts = transactionCounts(transaction, typing);
      // Net is document growth from manual editor actions. Pasting affects net
      // but earns no writing credit. Both values are always retained.
      const composition = transaction.startState.field(composing);
      // Candidate contractions retain prior writing credit, like ordinary
      // deletion. Re-expansion earns credit only above this composition's peak.
      const typedWords = transaction.isUserEvent('input.type.compose') && composition
        ? Math.max(0, composition.current + counts.net - composition.highWater)
        : counts.added;
      const credit = { ...session, added: typing ? typedWords : 0, net: counts.net };
      return { effects: creditEffect.of(credit) };
    }),
    invertedEffects.of(transaction => transaction.effects
      .filter(effect => effect.is(creditEffect))
      .map(effect => creditEffect.of({ ...effect.value, added: -effect.value.added, net: -effect.value.net }))),
    EditorView.updateListener.of(update => {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) if (effect.is(creditEffect)) receive(effect.value);
      }
    }),
  ];
}
