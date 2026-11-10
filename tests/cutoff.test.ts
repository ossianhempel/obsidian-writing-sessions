import { describe, expect, it } from 'vitest';
import { activeSession, applyCredit, dailyCounts, endExpiredSession, initialData, nextWritingCutoff, parseData, sessionCounts, type Data } from '../src/model';

function sessionAt(now: Date): Data {
  const data = initialData();
  data.sessions.push({ id: 'session', startedAt: now.toISOString(), endedAt: null, days: {} });
  return data;
}

describe('04:00 session cutoff', () => {
  it('keeps a session active before 04:00 and ends it exactly at the cutoff', () => {
    const data = sessionAt(new Date(2026, 10, 10, 22));
    applyCredit(data, { sessionId: 'session', day: '2026-11-10', added: 123, net: 110 });
    expect(endExpiredSession(data, new Date(2026, 10, 11, 3, 59, 59, 999))).toBe(false);
    expect(activeSession(data)?.id).toBe('session');
    expect(endExpiredSession(data, new Date(2026, 10, 11, 4))).toBe(true);
    expect(activeSession(data)).toBeUndefined();
    expect(data.sessions[0].endedAt).toBe(new Date(2026, 10, 11, 4).toISOString());
    expect(dailyCounts(data, '2026-11-10')).toEqual({ added: 123, net: 110 });
    expect(dailyCounts(data, '2026-11-11')).toEqual({ added: 0, net: 0 });
    expect(endExpiredSession(data, new Date(2026, 10, 11, 5))).toBe(false);
    expect(data.sessions).toHaveLength(1); // No automatic session for the next day.
  });
  it('puts an after-midnight start in the session that ends that morning', () => {
    const data = sessionAt(new Date(2026, 10, 11, 1));
    expect(endExpiredSession(data, new Date(2026, 10, 11, 4))).toBe(true);
    expect(data.sessions[0].endedAt).toBe(new Date(2026, 10, 11, 4).toISOString());
  });
  it('lets a session started exactly at 04:00 run until the following cutoff', () => {
    const data = sessionAt(new Date(2026, 10, 11, 4));
    expect(endExpiredSession(data, new Date(2026, 10, 11, 4))).toBe(false);
    expect(endExpiredSession(data, new Date(2026, 10, 12, 4))).toBe(true);
  });
  it('closes a session loaded days later at its original cutoff without losing counts', () => {
    const data = sessionAt(new Date(2026, 10, 10, 23));
    applyCredit(data, { sessionId: 'session', day: '2026-11-10', added: 176, net: 163 });
    const saved = parseData(JSON.parse(JSON.stringify(data)));
    expect(endExpiredSession(saved, new Date(2026, 10, 15, 12))).toBe(true);
    expect(saved.sessions[0].endedAt).toBe(new Date(2026, 10, 11, 4).toISOString());
    expect(sessionCounts(saved.sessions[0])).toEqual({ added: 176, net: 163 });
    expect(activeSession(saved)).toBeUndefined();
  });
  it('preserves all history from a legacy session that had already spanned days', () => {
    const data = sessionAt(new Date(2026, 10, 9, 23));
    applyCredit(data, { sessionId: 'session', day: '2026-11-09', added: 100, net: 90 });
    applyCredit(data, { sessionId: 'session', day: '2026-11-10', added: 61, net: 60 });
    const previous = structuredClone(data.sessions[0].days);
    expect(endExpiredSession(data, new Date(2026, 10, 10, 23))).toBe(true);
    expect(data.sessions[0].days).toEqual(previous);
  });
  it.each([
    [new Date(2026, 11, 31, 23), new Date(2027, 0, 1, 4)],
    [new Date(2026, 2, 28, 22), new Date(2026, 2, 29, 4)],
    [new Date(2026, 9, 24, 22), new Date(2026, 9, 25, 4)],
    [new Date(2026, 2, 29, 1), new Date(2026, 2, 29, 4)],
    [new Date(2026, 9, 25, 1), new Date(2026, 9, 25, 4)],
  ])('uses local 04:00 across year and daylight-saving boundaries (%s)', (started, cutoff) => {
    const data = sessionAt(started);
    expect(nextWritingCutoff(started)).toEqual(cutoff);
    expect(endExpiredSession(data, new Date(cutoff.getTime() - 1))).toBe(false);
    expect(endExpiredSession(data, cutoff)).toBe(true);
    expect(data.sessions[0].endedAt).toBe(cutoff.toISOString());
  });
});
