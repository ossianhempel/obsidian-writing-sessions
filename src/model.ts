export type Mode = 'added' | 'net';
export interface Counts { added: number; net: number }
export interface Session {
  id: string;
  startedAt: string;
  endedAt: string | null;
  days: Record<string, Counts>;
}
export interface Data {
  version: 1;
  target: number;
  mode: Mode;
  sessions: Session[];
}
export interface Credit extends Counts { sessionId: string; day: string }
export const emptyCounts = (): Counts => ({ added: 0, net: 0 });
export const initialData = (): Data => ({ version: 1, target: 100, mode: 'added', sessions: [] });

// Calendar arithmetic, not subtracting four elapsed hours, keeps the cutoff at
// local 04:00 even on daylight-saving transitions.
export function writingDay(now: Date): string {
  const local = new Date(now);
  if (local.getHours() < 4) local.setDate(local.getDate() - 1);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}
export function activeSession(data: Data): Session | undefined {
  return data.sessions.find(session => session.endedAt === null);
}
export function total(counts: Counts[]): Counts {
  return counts.reduce((sum, value) => ({ added: sum.added + value.added, net: sum.net + value.net }), emptyCounts());
}
export function sessionCounts(session: Session): Counts { return total(Object.values(session.days)); }
export function dailyCounts(data: Data, day: string): Counts {
  return total(data.sessions.map(session => session.days[day] ?? emptyCounts()));
}
export function applyCredit(data: Data, credit: Credit): void {
  const session = data.sessions.find(item => item.id === credit.sessionId);
  if (!session) return;
  const counts = session.days[credit.day] ??= emptyCounts();
  counts.added += credit.added;
  counts.net += credit.net;
}
export function parseData(value: unknown): Data {
  if (value === null || value === undefined) return initialData();
  const data = value as Data;
  const validCounts = (counts: Counts) => counts && Number.isSafeInteger(counts.added) && Number.isSafeInteger(counts.net);
  if (data.version !== 1 || !Number.isSafeInteger(data.target) || data.target < 1 ||
      !['added', 'net'].includes(data.mode) || !Array.isArray(data.sessions) ||
      !data.sessions.every(session => session && typeof session.id === 'string' &&
        typeof session.startedAt === 'string' && Number.isFinite(Date.parse(session.startedAt)) &&
        (session.endedAt === null || (typeof session.endedAt === 'string' && Number.isFinite(Date.parse(session.endedAt)))) &&
        session.days && typeof session.days === 'object' && !Array.isArray(session.days) &&
        Object.entries(session.days).every(([day, counts]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && validCounts(counts))) ||
      new Set(data.sessions.map(session => session.id)).size !== data.sessions.length ||
      data.sessions.filter(session => session.endedAt === null).length > 1) {
    throw new Error('Writing Sessions data is invalid. Your saved data has not been overwritten.');
  }
  return data;
}
