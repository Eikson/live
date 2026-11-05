import { describe, expect, it } from 'vitest';
import { isValidSchedule, matchesSchedule, nextScheduledDate, normalizeWeekdays } from '../../src/domain/schedule';

describe('schedule', () => {
  const monWedFri = { type: 'WEEKDAYS', days: [1, 3, 5] } as const;

  it('täglich passt an jedem Tag', () => {
    expect(matchesSchedule({ type: 'DAILY' }, '2026-11-08')).toBe(true);
  });

  it('Wochentage passen nur an den gewählten Tagen', () => {
    expect(matchesSchedule({ ...monWedFri, days: [...monWedFri.days] }, '2026-11-02')).toBe(true); // Mo
    expect(matchesSchedule({ ...monWedFri, days: [...monWedFri.days] }, '2026-11-03')).toBe(false); // Di
  });

  it('findet den nächsten geplanten Tag', () => {
    const s = { type: 'WEEKDAYS' as const, days: [1 as const] };
    expect(nextScheduledDate(s, '2026-11-02')).toBe('2026-11-09');
    expect(nextScheduledDate({ type: 'DAILY' }, '2026-11-02')).toBe('2026-11-03');
    expect(nextScheduledDate({ type: 'WEEKDAYS', days: [] }, '2026-11-02')).toBeUndefined();
  });

  it('normalisiert Wochentage: eindeutig, sortiert, nur 0–6', () => {
    expect(normalizeWeekdays([5, 1, 5, 7, -1, 2.5, 0])).toEqual([0, 1, 5]);
  });

  it('prüft Rhythmen', () => {
    expect(isValidSchedule({ type: 'DAILY' })).toBe(true);
    expect(isValidSchedule({ type: 'WEEKDAYS', days: [1, 3] })).toBe(true);
    expect(isValidSchedule({ type: 'WEEKDAYS', days: [] })).toBe(false);
    expect(isValidSchedule({ type: 'WEEKDAYS', days: [8] })).toBe(false);
    expect(isValidSchedule({ type: 'MONTHLY' })).toBe(false);
    expect(isValidSchedule(null)).toBe(false);
  });
});
