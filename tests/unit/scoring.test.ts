import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/domain/habit-history';
import { addDays, type LocalDate } from '../../src/domain/local-date';
import { compareWindow, windowMean } from '../../src/domain/scoring/comparison';
import { windowAverage } from '../../src/domain/scoring/corridor';
import { scoreBook, scoreDay, scoringHabits, type ScoringHabit } from '../../src/domain/scoring/day-score';
import { evaluatePatterns, hintSnoozeUntil, shouldShowHintCard } from '../../src/domain/scoring/patterns';
import { dayLimit, toleranceFor, wellbeingByDay, wellbeingOf } from '../../src/domain/scoring/wellbeing';
import type { CheckIn, Habit, HabitEvent } from '../../src/domain/types';
import { byDay, checkIn, checkInRun, event, makeHabit, NOW } from '../helpers';

const A = '2026-01-01';
const day = (n: number): LocalDate => addDays(A, n);

function sh(
  habit: Habit,
  checkIns: CheckIn[],
  opts: { events?: HabitEvent[]; integratedFrom?: LocalDate } = {},
): ScoringHabit {
  return {
    timeline: buildTimeline(habit, opts.events ?? []),
    checkIns: byDay(checkIns),
    isIntegratedOn: (d) => opts.integratedFrom !== undefined && d >= opts.integratedFrom,
  };
}

describe('Tagesscore', () => {
  it('summiert Gewicht × Erfüllung, Decke und Boden', () => {
    const a = sh(makeHabit({ id: 'a', weight: 2 }), [checkIn('a', A, 'DONE')], { integratedFrom: A });
    const b = sh(makeHabit({ id: 'b', weight: 1 }), [checkIn('b', A, 'DONE', true)]);
    const s = scoreDay({ habits: [a, b], exceptionDays: new Set() }, A);
    expect(s).toMatchObject({ planned: 2, evaluable: true, score: 2.5, ceiling: 3, integratedWeight: 2 });
    expect(s.floor).toBeCloseTo(1.2);
  });

  it('Ausweichoption zählt voll, nicht gemacht zählt 0', () => {
    const a = sh(makeHabit({ id: 'a' }), [checkIn('a', A, 'ALTERNATIVE')]);
    const b = sh(makeHabit({ id: 'b' }), [checkIn('b', A, 'NOT_DONE')]);
    expect(scoreDay({ habits: [a, b], exceptionDays: new Set() }, A).score).toBe(1);
  });

  it('ein fehlender Eintrag macht den Tag zur Lücke, nicht zu 0', () => {
    const a = sh(makeHabit({ id: 'a' }), [checkIn('a', A, 'DONE')]);
    const b = sh(makeHabit({ id: 'b' }), []);
    expect(scoreDay({ habits: [a, b], exceptionDays: new Set() }, A).evaluable).toBe(false);
  });

  it('Ausnahmetage und Tage ohne Plan sind nicht bewertbar', () => {
    const a = sh(makeHabit({ id: 'a' }), [checkIn('a', A, 'DONE')]);
    expect(scoreDay({ habits: [a], exceptionDays: new Set([A]) }, A)).toMatchObject({
      evaluable: false,
      exception: true,
    });
    // 2026-01-01 ist ein Donnerstag
    const weekly = sh(makeHabit({ id: 'w', schedule: { type: 'WEEKDAYS', days: [1] } }), []);
    expect(scoreDay({ habits: [weekly], exceptionDays: new Set() }, A)).toMatchObject({ planned: 0, evaluable: false });
  });

  it('„Trotzdem gemacht“ an nicht geplanten Tagen zählt nie', () => {
    const habit = makeHabit({ id: 'w', schedule: { type: 'WEEKDAYS', days: [1] } });
    const extra = { ...checkIn('w', A, 'DONE'), unplanned: true };
    const s = scoreDay({ habits: [sh(habit, [extra])], exceptionDays: new Set() }, A);
    expect(s).toMatchObject({ planned: 0, score: 0, ceiling: 0 });
  });

  it('Gewicht gilt so, wie es am jeweiligen Tag war', () => {
    const habit = makeHabit({ id: 'a', weight: 3 });
    const events = [event('a', day(5), 'WEIGHT_CHANGED', 1, 3)];
    const h = sh(habit, checkInRun('a', A, 10, 'DONE'), { events });
    const book = scoreBook({ habits: [h], exceptionDays: new Set() });
    expect(book(day(4)).score).toBe(1);
    expect(book(day(5)).score).toBe(3);
  });

  it('archivierte Habits fallen rückwirkend heraus, pausierte nur auf Wunsch', () => {
    const habits = [
      sh(makeHabit({ id: 'a' }), []),
      sh(makeHabit({ id: 'p', status: 'PAUSED' }), []),
      sh(makeHabit({ id: 'x', status: 'ARCHIVED' }), []),
    ];
    expect(scoringHabits(habits).map((h) => h.timeline.habit.id)).toEqual(['a', 'p']);
    expect(scoringHabits(habits, { excludePaused: true }).map((h) => h.timeline.habit.id)).toEqual(['a']);
  });
});

describe('Befinden und Tagesgrenze', () => {
  it('Mittelwert der vorhandenen Werte', () => {
    expect(wellbeingOf({ mood: 2, energy: 4 })).toBe(3);
    expect(wellbeingOf({ mood: 1 })).toBe(1);
    expect(wellbeingOf({})).toBeUndefined();
    expect(wellbeingOf(undefined)).toBeUndefined();
  });

  it('Ausnahmetage zählen nicht zum Befinden', () => {
    const map = wellbeingByDay([
      { localDate: A, mood: 4, updatedAt: NOW },
      { localDate: day(1), mood: 1, exception: { reason: 'SICK' }, updatedAt: NOW },
    ]);
    expect([...map.keys()]).toEqual([A]);
  });

  it('Toleranz 0,4 bei Befinden ≤ 2, sonst 0,6', () => {
    expect(toleranceFor(2)).toBe(0.4);
    expect(toleranceFor(1.5)).toBe(0.4);
    expect(toleranceFor(2.5)).toBe(0.6);
    expect(toleranceFor(undefined)).toBe(0.6);
    const h = sh(makeHabit({ weight: 2 }), [checkIn('h1', A, 'DONE')], { integratedFrom: A });
    const s = scoreDay({ habits: [h], exceptionDays: new Set() }, A);
    expect(dayLimit(s, 2)).toBeCloseTo(0.8);
    expect(dayLimit(s, undefined)).toBeCloseTo(1.2);
  });
});

describe('Korridor', () => {
  it('Durchschnitt nur über bewertbare Tage, Start bei 0', () => {
    const checkIns = [...checkInRun('h1', A, 3, 'DONE'), checkIn('h1', day(3), 'NOT_DONE')];
    const h = sh(makeHabit(), checkIns, { integratedFrom: A });
    const book = scoreBook({ habits: [h], exceptionDays: new Set() });
    expect(windowAverage(book, addDays(A, -1))).toEqual({ days: 0, score: 0, floor: 0, ceiling: 0 });
    // Tage 0–3 bewertbar, 4–9 Lücken
    const w = windowAverage(book, day(9));
    expect(w.days).toBe(4);
    expect(w.score).toBeCloseTo(0.75);
    expect(w.floor).toBeCloseTo(0.6);
    expect(w.ceiling).toBe(1);
  });
});

type Mark = 'DONE' | 'MINIMAL' | 'NOT_DONE' | null;

describe('Hinweis-Muster', () => {
  function setup(marks: Mark[], opts: { integrated?: boolean; wellbeing?: number } = {}) {
    const checkIns = marks.flatMap((m, i) =>
      m === null ? [] : [m === 'MINIMAL' ? checkIn('h1', day(i), 'DONE', true) : checkIn('h1', day(i), m)],
    );
    const h = sh(makeHabit(), checkIns, opts.integrated === false ? {} : { integratedFrom: A });
    const scoreOf = scoreBook({ habits: [h], exceptionDays: new Set() });
    return { scoreOf, wellbeingOn: () => opts.wellbeing };
  }
  const repeat = (n: number, m: Mark): Mark[] => Array.from({ length: n }, () => m);
  const alternating = (n: number): Mark[] => Array.from({ length: n }, (_, i) => (i % 2 ? 'DONE' : 'NOT_DONE'));

  it('5 von 7 Tagen unter der Grenze lösen aus, 4 nicht', () => {
    const five = setup(['NOT_DONE', 'NOT_DONE', 'DONE', 'NOT_DONE', 'DONE', 'NOT_DONE', 'NOT_DONE']);
    expect(evaluatePatterns(five, day(6))).toMatchObject({ daysBelow: 5, shortTerm: true, due: true });
    const four = setup(['NOT_DONE', 'DONE', 'DONE', 'NOT_DONE', 'DONE', 'NOT_DONE', 'NOT_DONE']);
    expect(evaluatePatterns(four, day(6))).toMatchObject({ daysBelow: 4, shortTerm: false, due: false });
  });

  it('Lücken zählen nicht als Tage unter der Grenze', () => {
    const p = setup(['NOT_DONE', null, 'NOT_DONE', null, 'NOT_DONE', 'NOT_DONE', null]);
    expect(evaluatePatterns(p, day(6)).daysBelow).toBe(4);
  });

  it('Minimalversion (0,5) liegt über der Grenze 0,4 bei niedrigem Befinden, unter 0,6 sonst', () => {
    expect(evaluatePatterns(setup(repeat(7, 'MINIMAL')), day(6)).shortTerm).toBe(true);
    expect(evaluatePatterns(setup(repeat(7, 'MINIMAL'), { wellbeing: 2 }), day(6)).shortTerm).toBe(false);
  });

  it('ohne integrierte Habits nie ein Hinweis', () => {
    const p = setup(repeat(28, 'NOT_DONE'), { integrated: false });
    expect(evaluatePatterns(p, day(27))).toMatchObject({ daysBelow: 0, due: false });
  });

  it('langfristig: Ø28 unter Ø28-Boden erst ab 14 bewertbaren Tagen', () => {
    // abwechselnd: Ø 0,5 < Boden 0,6, kurzfristig aber höchstens 4 von 7 unter der Grenze
    expect(evaluatePatterns(setup(alternating(13)), day(12)).longTerm).toBe(false);
    expect(evaluatePatterns(setup(alternating(14)), day(13))).toMatchObject({
      shortTerm: false,
      longTerm: true,
      due: true,
    });
  });
});

describe('Hinweiskarte', () => {
  const today = day(20);
  it('erscheint nur, wenn fällig', () => {
    expect(shouldShowHintCard({ due: false, today })).toBe(false);
    expect(shouldShowHintCard({ due: true, today })).toBe(true);
  });
  it('höchstens einmal pro 7 Tage, am selben Tag weiter sichtbar', () => {
    expect(shouldShowHintCard({ due: true, today, lastShownAt: today })).toBe(true);
    expect(shouldShowHintCard({ due: true, today, lastShownAt: addDays(today, -6) })).toBe(false);
    expect(shouldShowHintCard({ due: true, today, lastShownAt: addDays(today, -7) })).toBe(true);
  });
  it('„So lassen“ blendet 7 Tage aus', () => {
    const snoozedUntil = hintSnoozeUntil(today);
    expect(snoozedUntil).toBe(day(27));
    expect(shouldShowHintCard({ due: true, today, lastShownAt: today, snoozedUntil })).toBe(false);
    expect(shouldShowHintCard({ due: true, today: day(26), lastShownAt: today, snoozedUntil })).toBe(false);
    expect(shouldShowHintCard({ due: true, today: day(27), lastShownAt: today, snoozedUntil })).toBe(true);
  });
});

describe('Vergleich', () => {
  const today = '2026-11-01';
  const values =
    (from: LocalDate, to: LocalDate) =>
    (d: LocalDate): number | undefined =>
      d >= from && d <= to ? 1 : undefined;

  it('Mittelwert über das Fenster, Lücken ausgenommen', () => {
    const w = windowMean((d) => (d === '2026-03-02' ? 4 : d === '2026-03-03' ? 2 : undefined), '2026-03-28');
    expect(w).toMatchObject({ days: 2, mean: 3, sufficient: false, from: '2026-03-01', to: '2026-03-28' });
  });

  it('nimmt das Fenster, das 182 Tage vor heute endet', () => {
    const end = addDays(today, -182);
    const c = compareWindow(values(addDays(end, -13), end), today, '2026-01-01');
    expect(c.kind).toBe('SIX_MONTHS');
    if (c.kind === 'SIX_MONTHS') expect(c.window).toMatchObject({ days: 14, to: end });
  });

  it('mit 13 Tagen im 6-Monats-Fenster und älteren Daten gibt es keinen Vergleich', () => {
    const end = addDays(today, -182);
    expect(compareWindow(values(addDays(end, -12), end), today, '2026-01-01').kind).toBe('NONE');
  });

  it('jüngere Daten: frühestes Fenster mit 14 Tagen („erste Wochen“)', () => {
    const first = addDays(today, -60);
    const c = compareWindow(values(first, today), today, first);
    expect(c.kind).toBe('FIRST_WEEKS');
    if (c.kind === 'FIRST_WEEKS') expect(c.window).toMatchObject({ days: 14, to: addDays(first, 13) });
  });

  it('das Vergleichsfenster liegt vor dem aktuellen Fenster', () => {
    // frühestes Fenster mit 14 Tagen endet am Tag first+13 = heute−27 → überlappt das aktuelle Fenster
    const first = addDays(today, -40);
    expect(compareWindow(values(first, today), today, first).kind).toBe('NONE');
    const earlier = addDays(today, -41);
    expect(compareWindow(values(earlier, today), today, earlier).kind).toBe('FIRST_WEEKS');
  });

  it('ohne Daten kein Vergleich', () => {
    expect(compareWindow(() => undefined, today, undefined).kind).toBe('NONE');
  });
});
