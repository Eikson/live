import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  diffDays,
  isLocalDate,
  startOfWeek,
  toLocalDate,
  weekdayOf,
} from '../../src/domain/local-date';

// Ohne @types/node: nur das, was der Test braucht.
declare const process: { env: Record<string, string | undefined> };

describe('local-date', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('rechnet über die Umstellung auf Sommerzeit hinweg in ganzen Tagen', () => {
    // In Berlin hat der 29.03.2026 nur 23 Stunden.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('rechnet über die Umstellung auf Winterzeit hinweg in ganzen Tagen', () => {
    // Der 25.10.2026 hat 25 Stunden.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(diffDays('2026-10-24', '2026-10-27')).toBe(3);
    expect(dateRange('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('ordnet späte Abendzeit am Umstellungstag dem richtigen lokalen Tag zu', () => {
    expect(toLocalDate(new Date(2026, 2, 29, 23, 30))).toBe('2026-03-29');
    expect(toLocalDate(new Date(2026, 9, 25, 0, 30))).toBe('2026-10-25');
  });

  it('verschiebt gespeicherte Tage bei einem Zeitzonenwechsel nicht', () => {
    const stored = '2026-11-05';
    const instant = new Date('2026-11-05T03:00:00.000Z');
    process.env.TZ = 'Europe/Berlin';
    expect(toLocalDate(instant)).toBe('2026-11-05');
    process.env.TZ = 'America/New_York';
    // Derselbe Zeitpunkt ist dort noch der Vortag; der gespeicherte Tag bleibt unverändert.
    expect(toLocalDate(instant)).toBe('2026-11-04');
    expect(addDays(stored, 1)).toBe('2026-11-06');
    expect(weekdayOf(stored)).toBe(4);
  });

  it('erkennt nur echte Kalendertage', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('26-01-01')).toBe(false);
    expect(isLocalDate(20260101)).toBe(false);
  });

  it('liefert Wochentag und Wochenbeginn (Montag)', () => {
    expect(weekdayOf('2026-11-08')).toBe(0);
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02');
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02');
    expect(startOfWeek('2026-11-05')).toBe('2026-11-02');
  });

  it('rechnet über Jahres- und Schaltjahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-11-05', '2026-11-01')).toBe(-4);
    expect(dateRange('2026-11-05', '2026-11-04')).toEqual([]);
  });
});
