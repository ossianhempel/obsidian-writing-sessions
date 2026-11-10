import { createHash } from 'node:crypto';
import { Text } from '@codemirror/state';

export interface WordOwner { sessionId: string; day: string }
export interface WordMark extends WordOwner { id: string; from: number; to: number }
export interface DocumentSnapshot { doc: Text; marks: WordMark[] }
export interface SavedDocument { digest: string; marks: WordMark[] }
export type SavedOwnership = Record<string, SavedDocument>;
export interface TrackingStorage {
  initial: Map<object, DocumentSnapshot>;
  commit: (key: object, snapshot: DocumentSnapshot) => void;
}
function fingerprint(text: string): string { return createHash('sha256').update(text).digest('hex'); }

// Exact-content restoration deliberately avoids guessing after external edits.
function restoreDocument(saved: SavedDocument, text: string): DocumentSnapshot | undefined {
  // Match CodeMirror's default line-ending normalization before comparing
  // fingerprints or offsets, so unchanged CRLF/CR notes restore like LF notes.
  const doc = Text.of(text.split(/\r\n?|\n/));
  if (saved.digest !== fingerprint(doc.toString()) || saved.marks.some(mark => mark.to > doc.length)) return undefined;
  return { doc, marks: saved.marks };
}
export function saveDocument(snapshot: DocumentSnapshot): SavedDocument {
  return { digest: fingerprint(snapshot.doc.toString()), marks: snapshot.marks };
}
export function validOwnership(value: unknown, sessions: Set<string>): value is SavedOwnership {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([path, item]) => {
    const document = item as SavedDocument;
    return path.length > 0 && document && /^[a-f0-9]{64}$/.test(document.digest) && Array.isArray(document.marks) &&
      document.marks.every(mark => mark && typeof mark.id === 'string' && mark.id.length > 0 &&
        sessions.has(mark.sessionId) && /^\d{4}-\d{2}-\d{2}$/.test(mark.day) &&
        Number.isSafeInteger(mark.from) && Number.isSafeInteger(mark.to) && mark.from >= 0 && mark.to > mark.from);
  });
}

export async function restoreOwnership(saved: SavedOwnership, load: (path: string) => Promise<{ key: object; text: string } | undefined>): Promise<Map<object, DocumentSnapshot>> {
  const restored = new Map<object, DocumentSnapshot>();
  for (const [path, record] of Object.entries(saved)) {
    const file = await load(path);
    const snapshot = file && restoreDocument(record, file.text);
    if (file && snapshot) restored.set(file.key, snapshot);
    else delete saved[path];
  }
  return restored;
}
