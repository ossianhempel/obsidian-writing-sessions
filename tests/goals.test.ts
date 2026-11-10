import { describe, expect, it } from 'vitest';
import { applyCredit, claimGoalCelebration, dailyCounts, initialData, parseData, type Data } from '../src/model';

const day = '2026-11-10';
function setup() {
  const data = initialData();
  data.target = 3;
  data.sessions.push({ id: 'session', startedAt: `${day}T12:00:00Z`, endedAt: null, days: {} });
  return data;
}
function write(data: Data, added: number, net = added, date = day) {
  const before = dailyCounts(data, date)[data.mode];
  applyCredit(data, { sessionId: 'session', day: date, added, net });
  return claimGoalCelebration(data, date, before);
}

describe('daily goal celebrations', () => {
  it('celebrates the crossing, including writing past the exact target', () => {
    const data = setup();
    expect(write(data, 2)).toBe(false);
    expect(write(data, 2)).toBe(true);
    expect(write(data, 1)).toBe(false);
    expect(dailyCounts(data, day).added).toBe(5);
  });
  it('does not repeat after deletion, undo, another session, or a restart', () => {
    const data = setup();
    expect(write(data, 3)).toBe(true);
    const restored = parseData(JSON.parse(JSON.stringify(data)));
    expect(write(restored, -1)).toBe(false);
    expect(write(restored, 1)).toBe(false);
    restored.sessions.push({ id: 'second', startedAt: `${day}T14:00:00Z`, endedAt: null, days: {} });
    const before = dailyCounts(restored, day).added;
    applyCredit(restored, { sessionId: 'second', day, added: 2, net: 2 });
    expect(claimGoalCelebration(restored, day, before)).toBe(false);
  });
  it('can celebrate again on the next writing day', () => {
    const data = setup();
    expect(write(data, 3)).toBe(true);
    expect(write(data, 3, 3, '2026-11-11')).toBe(true);
  });
  it('follows the selected count and never repeats when switching modes', () => {
    const data = setup();
    expect(write(data, 0, 3)).toBe(false);
    data.mode = 'net';
    expect(write(data, 1)).toBe(false); // Merely switching above the target is not a crossing.
    expect(write(data, 0, -2)).toBe(false);
    expect(write(data, 0, 1)).toBe(true);
    data.mode = 'added';
    expect(write(data, 2)).toBe(false);
  });
  it('does not celebrate lowering a goal or loading an already reached goal', () => {
    const data = setup();
    data.target = 100;
    expect(write(data, 5)).toBe(false);
    data.target = 3;
    const restored = parseData(JSON.parse(JSON.stringify(data)));
    expect(write(restored, 1)).toBe(false);
  });
  it('can be disabled without changing word counts', () => {
    const data = setup();
    data.celebrateGoal = false;
    expect(write(data, 3)).toBe(false);
    expect(dailyCounts(data, day).added).toBe(3);
    data.celebrateGoal = true;
    expect(write(data, 1)).toBe(false);
  });
  it('upgrades existing settings and validates saved celebration preferences', () => {
    const legacy: Partial<Data> = setup();
    delete legacy.celebrateGoal;
    delete legacy.celebratedDays;
    const restored = parseData(JSON.parse(JSON.stringify(legacy)));
    expect(write(restored, 3)).toBe(true);
    expect(() => parseData({ ...restored, celebrateGoal: 'yes' })).toThrow();
    expect(() => parseData({ ...restored, celebratedDays: ['invalid'] })).toThrow();
  });
});
