import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/domain/habit-history';
import { addDays, type LocalDate } from '../../src/domain/local-date';
import { integrationHistory, windowStats } from '../../src/domain/scoring/integration';
import type { CheckIn, Habit, HabitEvent } from '../../src/domain/types';
import { byDay, checkInRun, event, makeHabit } from '../helpers';

const A = '2026-01-01';
const day = (n: number): LocalDate => addDays(A, n);

function history(
  checkIns: CheckIn[],
  today: LocalDate,
  opts: { habit?: Habit; events?: HabitEvent[]; exceptions?: LocalDate[] } = {},
) {
  const habit = opts.habit ?? makeHabit({ activatedOn: A });
  const input = {
    timeline: buildTimeline(habit, opts.events ?? []),
    checkIns: byDay(checkIns),
    exceptionDays: new Set(opts.exceptions ?? []),
    today,
  };
  return { input, result: integrationHistory(input) };
}

describe('integration', () => {
  it('frühestens 30 Tage nach der Aktivierung', () => {
    const all = checkInRun('h1', A, 40, 'DONE');
    expect(history(all, day(29)).result.integrated).toBe(false);
    const { result } = history(all, day(30));
    expect(result.integrated).toBe(true);
    expect(result.integratedSince).toBe(day(30));
  });

  it('genau 80 % reichen zum Eintritt, darunter nicht', () => {
    // Fenster am Tag 30: Tage 1–30. 6 von 30 nicht gemacht → 24/30 = 80 %.
    const at80 = [...checkInRun('h1', day(1), 6, 'NOT_DONE'), ...checkInRun('h1', day(7), 24, 'DONE')];
    expect(history(at80, day(30)).result.integrated).toBe(true);
    // 7 von 30 nicht gemacht → 23/30 ≈ 77 %.
    const below = [...checkInRun('h1', day(1), 7, 'NOT_DONE'), ...checkInRun('h1', day(8), 23, 'DONE')];
    expect(history(below, day(30)).result.integrated).toBe(false);
  });

  it('Hysterese: bleibt bei genau 50 %, endet darunter', () => {
    const checkIns = [...checkInRun('h1', A, 30, 'DONE'), ...checkInRun('h1', day(30), 20, 'NOT_DONE')];
    const { result } = history(checkIns, day(45));
    // Tag 44: Fenster 15–44 → 15 gemacht, 15 nicht → genau 50 %.
    expect(result.isIntegratedOn(day(44))).toBe(true);
    // Tag 45: 14 von 30 → unter 50 %.
    expect(result.isIntegratedOn(day(45))).toBe(false);
    expect(result.transitions).toEqual([
      { date: day(30), integrated: true },
      { date: day(45), integrated: false },
    ]);
  });

  it('Minimalversion zählt voll für die Quote', () => {
    const minimal = checkInRun('h1', A, 31, 'DONE', true);
    expect(history(minimal, day(30)).result.integrated).toBe(true);
  });

  it('Abdeckung: mindestens zwei Drittel der geplanten Tage brauchen eine Angabe', () => {
    // 20 von 30 Tagen mit Angabe (genau 2/3) → zählt.
    expect(history(checkInRun('h1', day(11), 20, 'DONE'), day(30)).result.integrated).toBe(true);
    // 19 von 30 → zu wenig Angaben, kein Statuswechsel.
    expect(history(checkInRun('h1', day(12), 19, 'DONE'), day(30)).result.integrated).toBe(false);
  });

  it('Pausentage fallen aus dem Fenster', () => {
    const events = [
      event('h1', A, 'ACTIVATED', 'DRAFT', 'ACTIVE'),
      event('h1', day(10), 'PAUSED', 'ACTIVE', 'PAUSED'),
      event('h1', day(20), 'RESUMED', 'PAUSED', 'ACTIVE'),
    ];
    const checkIns = [...checkInRun('h1', A, 10, 'DONE'), ...checkInRun('h1', day(20), 11, 'DONE')];
    const { input, result } = history(checkIns, day(30), { events });
    // Fenster Tage 1–30 ohne die Pause 10–19: 9 + 11 = 20 geplante Tage, alle gemacht.
    expect(windowStats(input, day(30))).toEqual({ planned: 20, withEntry: 20, quotaSum: 20 });
    expect(result.integrated).toBe(true);
  });

  it('Ausnahmetage fallen aus dem Fenster', () => {
    const checkIns = checkInRun('h1', day(1), 30, 'DONE').filter((c) => c.localDate > day(10));
    const exceptions = Array.from({ length: 10 }, (_, i) => day(i + 1));
    const { input, result } = history(checkIns, day(30), { exceptions });
    expect(windowStats(input, day(30))).toEqual({ planned: 20, withEntry: 20, quotaSum: 20 });
    expect(result.integrated).toBe(true);
  });

  it('der heutige Tag zählt erst mit einer Angabe', () => {
    const checkIns = checkInRun('h1', A, 30, 'DONE'); // Tag 30 (heute) noch offen
    const { input } = history(checkIns, day(30));
    expect(windowStats(input, day(30)).planned).toBe(29);
    expect(history(checkIns, day(30)).result.integrated).toBe(true);
  });

  it('ohne Aktivierung nie integriert', () => {
    const habit = makeHabit({ status: 'DRAFT' });
    delete habit.activatedOn;
    const { result } = history(checkInRun('h1', A, 40, 'DONE'), day(40), { habit });
    expect(result.integrated).toBe(false);
    expect(result.isIntegratedOn(day(35))).toBe(false);
  });
});
