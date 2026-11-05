import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/domain/habit-history';
import { addDays } from '../../src/domain/local-date';
import { findReentry, type ReentryHabitInput } from '../../src/domain/reentry';
import type { Habit, HabitEvent } from '../../src/domain/types';
import { event, makeHabit } from '../helpers';

// Donnerstag, 15. Januar 2026
const TODAY = '2026-01-15';

function habitInput(habit: Habit, events: HabitEvent[] = [], checkInDates: string[] = []): ReentryHabitInput {
  return { timeline: buildTimeline(habit, events), events, checkInDates };
}

function find(habits: ReentryHabitInput[], opts: { entryDates?: string[]; exceptionDays?: string[] } = {}) {
  return findReentry({
    today: TODAY,
    habits,
    entryDates: [...(opts.entryDates ?? []), ...habits.flatMap((h) => h.checkInDates)],
    exceptionDays: new Set(opts.exceptionDays ?? []),
  });
}

describe('reentry', () => {
  it('erscheint ab 5 Tagen ohne jede Angabe', () => {
    const h = makeHabit();
    expect(find([habitInput(h, [], [addDays(TODAY, -4)])])).toBeUndefined();
    expect(find([habitInput(h, [], [addDays(TODAY, -5)])])).toEqual({ since: '2026-01-10', habitIds: ['h1'] });
  });

  it('jede Angabe zählt, auch Befinden oder ein anderes Habit', () => {
    const h = makeHabit();
    const old = habitInput(h, [], ['2026-01-02']);
    expect(find([old], { entryDates: ['2026-01-12'] })).toBeUndefined();
    const other = habitInput(makeHabit({ id: 'h2' }), [], ['2026-01-13']);
    expect(find([old, other])).toBeUndefined();
  });

  it('Aktivieren, Fortsetzen und ein früherer Wiedereinstieg zählen als Neustart', () => {
    const h = makeHabit({ activatedOn: '2026-01-01' });
    expect(find([habitInput(h)])?.habitIds).toEqual(['h1']);
    expect(find([habitInput(h, [event('h1', '2026-01-12', 'REENTERED', undefined, 'CONTINUE')])])).toBeUndefined();
    const resumed = [event('h1', '2026-01-01', 'ACTIVATED', 'DRAFT', 'ACTIVE'), event('h1', '2026-01-05', 'PAUSED', 'ACTIVE', 'PAUSED'), event('h1', '2026-01-13', 'RESUMED', 'PAUSED', 'ACTIVE')];
    expect(find([habitInput(h, resumed)])).toBeUndefined();
  });

  it('bei wenigen geplanten Tagen braucht es mindestens 2 geplante Gelegenheiten ohne Angabe', () => {
    // Nur montags: seit Sa, 10.1. liegt nur Mo, 12.1. dazwischen.
    const weekly = makeHabit({ schedule: { type: 'WEEKDAYS', days: [1] } });
    expect(find([habitInput(weekly, [], ['2026-01-10'])])).toBeUndefined();
    // Seit Sa, 3.1.: Mo 5.1. und Mo 12.1.
    expect(find([habitInput(weekly, [], ['2026-01-03'])])?.habitIds).toEqual(['h1']);
  });

  it('Ausnahmetage zählen nicht als Gelegenheit', () => {
    const weekly = makeHabit({ schedule: { type: 'WEEKDAYS', days: [1] } });
    expect(find([habitInput(weekly, [], ['2026-01-03'])], { exceptionDays: ['2026-01-05'] })).toBeUndefined();
  });

  it('heute zählt nicht als verpasste Gelegenheit; nur betroffene Habits erscheinen', () => {
    const daily = makeHabit({ activatedOn: '2026-01-01' });
    const thursday = makeHabit({ id: 'h2', schedule: { type: 'WEEKDAYS', days: [4] }, activatedOn: '2026-01-07' });
    // h2 (donnerstags) seit Mi, 7.1.: nur Do, 8.1. dazwischen, heute zählt nicht.
    expect(find([habitInput(daily), habitInput(thursday)], { entryDates: ['2026-01-09'] })).toEqual({
      since: '2026-01-09',
      habitIds: ['h1'],
    });
  });

  it('ohne aktive Habits keine Karte', () => {
    expect(find([], { entryDates: ['2026-01-01'] })).toBeUndefined();
  });
});
