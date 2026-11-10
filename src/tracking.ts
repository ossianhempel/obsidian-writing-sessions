import { EditorState, findClusterBreak, StateEffect, StateField, type ChangeDesc, type Extension, type TransactionSpec, Transaction, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import { historyReceipt, recordHistory, mapHistory, replayHistory, untrackedHistory, type OwnershipHistory } from './history';
import type { Credit } from './model';
import type { WordOwner as Owner, WordMark as Mark, DocumentSnapshot as Snapshot, TrackingStorage } from './ownership';

// A word may contain internal apostrophes/hyphens. Markdown symbols do not count.
const words = () => /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
export function wordCount(text: string): number { return [...text.matchAll(words())].length; }
interface Patch { from: number; to: number; marks: Mark[] }
interface Ownership { key: object; marks: Mark[]; sessionId?: string; pending?: Snapshot; history: OwnershipHistory }
const documentEffect = StateEffect.define<Ownership>();

function wordCharacter(char: string): boolean { return /[\p{L}\p{N}'’\-]/u.test(char); }
function context(doc: Text, from: number, to: number): [number, number] {
  const insidePair = (position: number) => position > 0 && position < doc.length &&
    /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(doc.sliceString(position - 1, position + 1));
  if (insidePair(from)) from--;
  if (insidePair(to)) to++;
  while (from > 0) {
    let previous = from - 1;
    if (insidePair(previous)) previous--;
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
function tokens(doc: Text, from: number, to: number) {
  return [...doc.sliceString(from, to).matchAll(words())].map(match => ({ from: from + match.index, to: from + match.index + match[0].length }));
}
function overlaps(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && b.from < a.to;
}
function mapMarks(marks: Mark[], changes: ChangeDesc): Mark[] {
  return marks.map(mark => ({ ...mark, from: changes.mapPos(mark.from, 1), to: changes.mapPos(mark.to, -1) })).filter(mark => mark.from < mark.to);
}
function matchSources(candidates: number[][], baseline: (source: number) => boolean): (number | undefined)[] {
  const matched: (number | undefined)[] = candidates.map(() => undefined);
  // Add baseline origins first. Later augmenting paths may move them, but
  // never discard one merely to retain a current-session origin instead.
  const sources = [...new Set(candidates.flat())].sort((a, b) => Number(baseline(b)) - Number(baseline(a)));
  function assign(source: number, seen: Set<number>): boolean {
    for (let token = 0; token < candidates.length; token++) {
      if (seen.has(token) || !candidates[token].includes(source)) continue;
      seen.add(token);
      const previous = matched[token];
      if (previous !== undefined && !assign(previous, seen)) continue;
      matched[token] = source;
      return true;
    }
    return false;
  }
  for (const source of sources) assign(source, new Set());
  return matched;
}
const ownershipEffect = StateEffect.define<Patch>();
export const creditEffect = StateEffect.define<Credit>();
// Replay the original edit's eligibility, even if another session is active.
interface Eligibility { id: string; before: boolean; after: boolean }
const eligibilityEffect = StateEffect.define<readonly Eligibility[]>();
const cutEffect = StateEffect.define<{ id: string; part: 'active' | 'pasted'; value: boolean }>();

export function trackingExtension(
  current: () => Owner | undefined,
  receive: (credit: Credit) => void,
  documentKey?: (state: EditorState) => object | undefined,
  storage?: TrackingStorage,
): Extension {
  // Restore only validated documents. Runtime file objects also survive renames.
  const documents = new WeakMap<object, Snapshot>();
  const written = new Map<string, { owner: Owner; files: Set<object>; credited: boolean }>();
  for (const [key, snapshot] of storage?.initial ?? []) {
    documents.set(key, snapshot);
    for (const mark of snapshot.marks) {
      let word = written.get(mark.id);
      if (!word) written.set(mark.id, word = { owner: { sessionId: mark.sessionId, day: mark.day }, files: new Set(), credited: true });
      word.files.add(key);
    }
  }
  let cut: { id: string; active: boolean; pasted: boolean; linewise: boolean; text: string; marks: Mark[]; sessionId: string } | undefined;
  function initial(state: EditorState): Ownership {
    const key = documentKey?.(state) ?? {};
    const saved = documents.get(key);
    if (saved && !saved.doc.eq(state.doc)) {
      documents.delete(key);
      for (const mark of saved.marks) written.get(mark.id)?.files.delete(key);
      storage?.commit(key, { doc: state.doc, marks: [] });
    }
    return { key, marks: saved?.doc.eq(state.doc) ? saved.marks : [], sessionId: current()?.sessionId, history: { done: [], undone: [] } };
  }
  function before(state: EditorState): Ownership { return state.field(ownership, false) ?? initial(state); }
  const ownership = StateField.define<Ownership>({
    create: initial,
    update: (_value, transaction) => {
      const switched = transaction.effects.find(effect => effect.is(documentEffect));
      if (switched) return switched.value;
      const value = before(transaction.startState);
      const receipts = transaction.effects.flatMap(effect => effect.is(historyReceipt) ? effect.value : []);
      if ((transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) && receipts.length) {
        const replayed = replayHistory(value.history, receipts, transaction.isUserEvent('redo'), transaction.startState.doc, value.marks, (doc, marks) => {
          const used = new Set<Mark>();
          return tokens(doc, 0, doc.length).flatMap(token => {
            const mark = marks.find(mark => !used.has(mark) && overlaps(mark, token));
            if (!mark) return [];
            used.add(mark);
            return [{ ...mark, ...token }];
          });
        });
        if (!replayed.doc.eq(transaction.newDoc)) throw new Error('Writing-session history does not match editor changes');
        return { ...value, marks: replayed.marks, history: replayed.history, sessionId: current()?.sessionId };
      }
      let marks = mapMarks(value.marks, transaction.changes);
      for (const effect of transaction.effects) if (effect.is(ownershipEffect)) {
        marks = marks.filter(mark => !overlaps(mark, effect.value)).concat(effect.value.marks);
      }
      let history = value.history;
      if (transaction.docChanged) {
        if (transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) history = untrackedHistory(history, transaction.changes, transaction.startState.doc, transaction.isUserEvent('redo'));
        else if (transaction.annotation(Transaction.addToHistory) === false) history = mapHistory(history, transaction.changes.desc);
        else if (receipts.length) history = recordHistory(history, receipts[0], transaction.changes, transaction.startState.doc, value.marks, marks);
      }
      return { key: value.key, marks, history, pending: transaction.docChanged ? undefined : value.pending, sessionId: current()?.sessionId };
    },
  });
  return [
    ownership,
    EditorView.domEventHandlers({ copy: () => { cut = undefined; } }),
    EditorState.transactionExtender.of(transaction => {
      const extension = extend(transaction);
      if (!transaction.docChanged || transaction.isUserEvent('undo') || transaction.isUserEvent('redo') || transaction.annotation(Transaction.addToHistory) === false) return extension;
      const effects = extension?.effects;
      return { ...extension, effects: [...(Array.isArray(effects) ? effects : effects ? [effects] : []), historyReceipt.of([{}])] };
    }),
    invertedEffects.of(transaction => {
      const effects: StateEffect<unknown>[] = [];
      for (const effect of transaction.effects) {
        if (effect.is(cutEffect)) effects.push(cutEffect.of({ ...effect.value, value: !effect.value.value }));
        if (effect.is(eligibilityEffect)) effects.unshift(eligibilityEffect.of(effect.value.map(item => ({ id: item.id, before: item.after, after: item.before }))));
        if (effect.is(creditEffect)) effects.push(creditEffect.of({ ...effect.value, added: -effect.value.added, net: -effect.value.net }));
      }
      const receipts = transaction.effects.flatMap(effect => effect.is(historyReceipt) ? effect.value : []);
      if (receipts.length) effects.push(historyReceipt.of([...receipts].reverse()));
      return effects;
    }),
    EditorView.updateListener.of(update => {
      const deltas = new Map<string, Credit>();
      function add(credit: Credit) {
        const key = `${credit.sessionId}/${credit.day}`;
        const delta = deltas.get(key) ?? { ...credit, added: 0, net: 0 };
        delta.added += credit.added;
        delta.net += credit.net;
        deltas.set(key, delta);
      }
      const value = update.state.field(ownership);
      const switched = update.startState.field(ownership, false)?.key !== value.key;
      if (update.docChanged || switched) {
        const snapshot = documents.get(value.key);
        const previous = snapshot?.marks ?? [];
        const changed = new Set([...(snapshot?.doc.eq(update.startState.doc) ? previous : []), ...value.marks].map(mark => mark.id));
        for (const mark of previous) written.get(mark.id)?.files.delete(value.key);
        for (const mark of value.marks) {
          let word = written.get(mark.id);
          if (!word) written.set(mark.id, word = { owner: { sessionId: mark.sessionId, day: mark.day }, files: new Set(), credited: false });
          word.files.add(value.key);
        }
        const eligible = new Map(update.transactions.flatMap(transaction => transaction.effects.flatMap(effect => effect.is(eligibilityEffect) ? effect.value.map(item => [item.id, item.after] as const) : [])));
        for (const id of eligible.keys()) changed.add(id);
        for (const id of changed) {
          const word = written.get(id);
          if (!word || !eligible.has(id)) continue;
          const credited = word.files.size > 0 || eligible.get(id)!;
          if (credited !== word.credited) {
            word.credited = credited;
            add({ ...word.owner, added: credited ? 1 : -1, net: 0 });
          }
        }
        documents.set(value.key, { doc: update.state.doc, marks: value.marks });
      }
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) if (effect.is(creditEffect)) add(effect.value);
      }
      for (const delta of deltas.values()) if (delta.added || delta.net) receive(delta);
      if (update.docChanged || switched || deltas.size) storage?.commit(value.key, { doc: update.state.doc, marks: value.marks });
    }),
  ];
  function extend(transaction: Transaction): Pick<TransactionSpec, 'effects' | 'annotations'> | null {
    const session = current();
    const value = before(transaction.startState);
    const key = documentKey?.(transaction.state) ?? value.key;
    if (key !== value.key) {
      const cached = documents.get(key);
      const matches = cached?.doc.eq(transaction.newDoc);
      // Detach rejected origins immediately. Keep a private pending snapshot
      // only for a subsequent file-load transaction, never as live ownership.
      return { effects: documentEffect.of({ key, marks: matches && cached ? cached.marks : [], pending: matches ? undefined : cached, sessionId: session?.sessionId, history: value.history }) };
    }
    const typing = transaction.isUserEvent('input.type') || transaction.annotation(Transaction.userEvent) === 'input';
    const direct = transaction.isUserEvent('input') || transaction.isUserEvent('delete') || transaction.isUserEvent('move');
    const boundary = (!value.history.done.length && !value.history.undone.length || value.sessionId !== session?.sessionId) ? { annotations: isolateHistory.of('before') } : null;
    if (transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) {
      for (const effect of transaction.effects) if (effect.is(cutEffect) && cut?.id === effect.value.id) cut[effect.value.part] = effect.value.value;
      return boundary;
    }
    if (!transaction.docChanged || transaction.effects.some(effect => effect.is(ownershipEffect) || effect.is(creditEffect))) return boundary;
    const cached = value.pending ?? documents.get(value.key);
    // Only load/sync transactions can restore a cached document. Matching an
    // old snapshot after manual typing is not evidence of shared origins.
    if (!direct && cached?.doc.eq(transaction.newDoc)) {
      return { ...boundary, effects: ownershipEffect.of({ from: 0, to: transaction.newDoc.length, marks: cached.marks }) };
    }
    const activeMarks = value.marks.filter(mark => mark.sessionId === session?.sessionId);
    let moved: Mark[] = [];
    let nextCut: typeof cut;
    let pasted: string | undefined;
    const movedSources: { text: string; marks: Mark[] }[] = [];
    if (transaction.isUserEvent('move')) transaction.changes.iterChanges((from, to) => {
      if (from >= to) return;
      const text = transaction.startState.doc.sliceString(from, to);
      const leading = text.length - text.trimStart().length;
      movedSources.push({ text: text.trim(), marks: value.marks
        .filter(mark => mark.from >= from && mark.to <= to)
        .map(mark => ({ ...mark, from: mark.from - from - leading, to: mark.to - from - leading })) });
    });
    transaction.changes.iterChanges((fromA, toA, fromB, _toB, insert) => {
      if (session && transaction.isUserEvent('delete.cut')) {
        // A single-selection cut can transfer existing credit on its next
        // matching paste, including across notes. Copy/paste earns no credit.
        const { startState } = transaction;
        const line = startState.doc.lineAt(fromA);
        const linewise = startState.selection.ranges.length === 1 && startState.selection.main.empty && fromA === line.from && toA === Math.min(startState.doc.length, line.to + 1);
        nextCut = { id: crypto.randomUUID(), active: true, pasted: false, linewise, sessionId: session.sessionId, text: startState.doc.sliceString(fromA, linewise ? line.to : toA), marks: value.marks
          .filter(mark => mark.from >= fromA && mark.to <= toA)
          .map(mark => ({ ...mark, from: mark.from - fromA, to: mark.to - fromA })) };
      }
      if (session && transaction.isUserEvent('input.paste') && cut?.active && !cut.pasted && cut.sessionId === session.sessionId &&
          (insert.toString() === cut.text || cut.linewise && insert.toString() === `${cut.text}\n`)) {
        moved = cut.marks.map(mark => ({ ...mark, from: mark.from + fromB, to: mark.to + fromB }));
        cut.pasted = true;
        pasted = cut.id;
      }
      const inserted = insert.toString();
      const source = movedSources.findIndex(source => source.text === inserted.trim());
      const offset = fromB + inserted.length - inserted.trimStart().length;
      if (source >= 0) moved.push(...movedSources.splice(source, 1)[0].marks.map(mark => ({ ...mark, from: mark.from + offset, to: mark.to + offset })));
    });
    if (nextCut) cut = nextCut;
    const ranges: { a: number; z: number; b: number; y: number }[] = [];
    const inverse = transaction.changes.invertedDesc;
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      let [a, z] = context(transaction.startState.doc, fromA, toA);
      let [b, y] = context(transaction.newDoc, fromB, toB);
      // Keep both contexts aligned even when an edit cuts a surrogate pair
      // or changes whether punctuation belongs to a neighboring word.
      for (;;) {
        const [nextA, nextZ] = context(transaction.startState.doc, Math.min(a, inverse.mapPos(b, -1)), Math.max(z, inverse.mapPos(y, 1)));
        const [nextB, nextY] = context(transaction.newDoc, Math.min(b, transaction.changes.mapPos(nextA, -1)), Math.max(y, transaction.changes.mapPos(nextZ, 1)));
        if (nextA === a && nextZ === z && nextB === b && nextY === y) break;
        [a, z, b, y] = [nextA, nextZ, nextB, nextY];
      }
      const last = ranges.at(-1);
      if (last && (a <= last.z || b <= last.y)) { last.z = Math.max(last.z, z); last.y = Math.max(last.y, y); }
      else ranges.push({ a, z, b, y });
    });
    const gaps: { old: number; current: number; length: number }[] = [];
    transaction.changes.iterGaps((old, current, length) => gaps.push({ old, current, length }));
    // The editor transposes two grapheme clusters by replacing both. Follow
    // those moved characters as source letters, including across word bounds.
    if (transaction.isUserEvent('move.character')) transaction.changes.iterChanges((from, to, current, _end, insert) => {
      const text = transaction.startState.doc.sliceString(from, to);
      const split = findClusterBreak(text, 0);
      if (split > 0 && split < text.length && findClusterBreak(text, split) === text.length && insert.toString() === text.slice(split) + text.slice(0, split)) {
        gaps.push({ old: from, current: current + text.length - split, length: split }, { old: from + split, current, length: text.length - split });
      }
    });
    // Keep source-cut state separate from paste consumption. Undoing a paste
    // can make the receipt available again only while that cut still exists.
    const effects: StateEffect<unknown>[] = nextCut ? [cutEffect.of({ id: nextCut.id, part: 'active', value: true })] : [];
    if (pasted) effects.push(cutEffect.of({ id: pasted, part: 'pasted', value: true }));
    const eligible = new Set<string>();
    let net = 0;
    for (const range of ranges) {
      const oldTokens = tokens(transaction.startState.doc, range.a, range.z);
      const newTokens = tokens(transaction.newDoc, range.b, range.y);
      const owned = oldTokens.map(token => value.marks.find(mark => overlaps(mark, token)));
      // A full rewrite keeps an existing session-word identity, including
      // identities shared by a moved word and its restored source copy.
      const replaced = oldTokens.flatMap((token, index) => {
        const owner = owned[index];
        if (!owner || owner.sessionId !== session?.sessionId) return [];
        const survives = gaps.some(gap => {
          const from = Math.max(token.from, gap.old), to = Math.min(token.to, gap.old + gap.length);
          return from < to && /[\p{L}\p{N}]/u.test(transaction.startState.doc.sliceString(from, to));
        });
        return survives ? [] : [index];
      });
      const origins = [...owned, ...moved];
      const baseline = (source: number) => !origins[source] || origins[source].sessionId !== session?.sessionId;
      const ancestry = newTokens.map(token => {
        const sources = new Set<number>();
        for (const gap of gaps) {
          const from = Math.max(token.from, gap.current);
          const to = Math.min(token.to, gap.current + gap.length);
          if (from >= to) continue;
          const oldFrom = gap.old + from - gap.current;
          const oldTo = gap.old + to - gap.current;
          oldTokens.forEach((source, index) => {
            const a = Math.max(oldFrom, source.from), z = Math.min(oldTo, source.to);
            if (a < z && /[\p{L}\p{N}]/u.test(transaction.startState.doc.sliceString(a, z))) sources.add(index);
          });
        }
        const candidates = [...sources, ...moved.flatMap((mark, index) => overlaps(mark, token) ? [owned.length + index] : [])];
        return { candidates, survives: sources.size > 0 };
      });
      // Match origins across the whole range before consuming any one of
      // them. A paste can split a destination word, whose identity must stay
      // available for its suffix while the prefix retains the cut identity.
      const matched = matchSources(ancestry.map(item => item.candidates), baseline);
      const used = new Set(matched.filter(source => source !== undefined));
      const marks: Mark[] = [];
      newTokens.forEach((token, index) => {
        const source = matched[index];
        let owner: (Owner & { id: string }) | undefined;
        if (source !== undefined) owner = origins[source];
        else if (typing && session) {
          const replacement = !ancestry[index].survives ? replaced.find(index => !used.has(index)) : undefined;
          if (replacement !== undefined) { used.add(replacement); owner = owned[replacement]; }
          else owner = { ...session, id: crypto.randomUUID() };
        }
        if (owner) marks.push({ ...owner, from: token.from, to: token.to });
      });
      effects.push(ownershipEffect.of({ from: range.b, to: range.y, marks }));
      if (session && direct) {
        for (const mark of activeMarks) if (overlaps(mark, { from: range.a, to: range.z })) eligible.add(mark.id);
        for (const mark of marks) if (mark.sessionId === session.sessionId) eligible.add(mark.id);
      }
      net += newTokens.length - oldTokens.length;
    }
    if (eligible.size) {
      let after = mapMarks(value.marks, transaction.changes);
      for (const effect of effects) if (effect.is(ownershipEffect)) after = after.filter(mark => !overlaps(mark, effect.value)).concat(effect.value.marks);
      effects.push(eligibilityEffect.of([...eligible].map(id => ({
        id, before: written.get(id)?.credited ?? false,
        after: after.some(mark => mark.id === id) || [...(written.get(id)?.files ?? [])].some(key => key !== value.key),
      }))));
    }
    if (session && direct && net) effects.push(creditEffect.of({ ...session, added: 0, net }));
    return { ...boundary, effects };
  }
}
