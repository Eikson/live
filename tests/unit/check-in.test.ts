import { describe, expect, it } from 'vitest';
import { buildCheckIn, isValidOutcome, isWithinBackfill, type CheckInInput } from '../../src/domain/check-in';
import { addDays } from '../../src/domain/local-date';
import { counterIds } from '../helpers';

const today = '2026-11-05';
const ctx = (now = '2026-11-05T09:00:00.000Z') => ({ today, now, newId: counterIds('c') });
const input = (overrides: Partial<CheckInInput> = {}): CheckInInput => ({
  habitId: 'h1',
  kind: 'BUILD',
  localDate: today,
  outcome: 'DONE',
  unplanned: false,
  ...overrides,
});

describe('check-in', () => {
  it('erlaubt heute und genau 7 Tage rückwirkend, nie die Zukunft', () => {
    expect(isWithinBackfill(today, today)).toBe(true);
    expect(isWithinBackfill(addDays(today, -7), today)).toBe(true);
    expect(isWithinBackfill(addDays(today, -8), today)).toBe(false);
    expect(isWithinBackfill(addDays(today, 1), today)).toBe(false);
    expect(buildCheckIn(undefined, input({ localDate: addDays(today, -8) }), ctx())).toEqual({
      ok: false,
      error: 'OUT_OF_RANGE',
    });
  });

  it('prüft das Ergebnis passend zur Habit-Art', () => {
    expect(isValidOutcome('BUILD', 'DONE')).toBe(true);
    expect(isValidOutcome('BUILD', 'KEPT')).toBe(false);
    expect(isValidOutcome('COUNTER_PROCRASTINATION', 'PARTIAL')).toBe(true);
    expect(buildCheckIn(undefined, input({ outcome: 'YES' }), ctx())).toEqual({ ok: false, error: 'INVALID_OUTCOME' });
  });

  it('eine Korrektur behält ID und Anlagezeit', () => {
    const first = buildCheckIn(undefined, input(), ctx());
    if (!first.ok) throw new Error('unerwartet');
    const corrected = buildCheckIn(first.checkIn, input({ outcome: 'NOT_DONE' }), ctx('2026-11-05T20:00:00.000Z'));
    if (!corrected.ok) throw new Error('unerwartet');
    expect(corrected.checkIn.id).toBe(first.checkIn.id);
    expect(corrected.checkIn.createdAt).toBe('2026-11-05T09:00:00.000Z');
    expect(corrected.checkIn.updatedAt).toBe('2026-11-05T20:00:00.000Z');
    expect(corrected.checkIn.outcome).toBe('NOT_DONE');
  });

  it('Minimalversion gibt es nur bei „Gemacht“', () => {
    const done = buildCheckIn(undefined, input({ minimal: true }), ctx());
    if (!done.ok) throw new Error('unerwartet');
    expect(done.checkIn.minimal).toBe(true);
    // Ohne Angabe bleibt die Minimalversion beim gleichen Ergebnis erhalten …
    const same = buildCheckIn(done.checkIn, input({ note: 'kurz' }), ctx());
    expect(same.ok && same.checkIn.minimal).toBe(true);
    // … und fällt bei einem anderen Ergebnis weg.
    const alt = buildCheckIn(done.checkIn, input({ outcome: 'ALTERNATIVE', minimal: true }), ctx());
    expect(alt.ok && alt.checkIn.minimal).toBe(false);
  });

  it('Notizen: getrimmt, null entfernt, undefined lässt sie stehen, Länge begrenzt', () => {
    const withNote = buildCheckIn(undefined, input({ note: '  Regen  ' }), ctx());
    if (!withNote.ok) throw new Error('unerwartet');
    expect(withNote.checkIn.note).toBe('Regen');
    const kept = buildCheckIn(withNote.checkIn, input({ outcome: 'ALTERNATIVE' }), ctx());
    expect(kept.ok && kept.checkIn.note).toBe('Regen');
    const removed = buildCheckIn(withNote.checkIn, input({ note: null }), ctx());
    expect(removed.ok && 'note' in removed.checkIn).toBe(false);
    const blank = buildCheckIn(withNote.checkIn, input({ note: '   ' }), ctx());
    expect(blank.ok && 'note' in blank.checkIn).toBe(false);
    expect(buildCheckIn(undefined, input({ note: 'x'.repeat(1001) }), ctx())).toEqual({
      ok: false,
      error: 'NOTE_TOO_LONG',
    });
    expect(buildCheckIn(undefined, input({ note: 'x'.repeat(1000) }), ctx()).ok).toBe(true);
  });

  it('übernimmt „Trotzdem gemacht“ als Markierung', () => {
    const r = buildCheckIn(undefined, input({ unplanned: true }), ctx());
    expect(r.ok && r.checkIn.unplanned).toBe(true);
  });
});
