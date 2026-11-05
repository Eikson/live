import { describe, expect, it } from 'vitest';
import { applyHabitEdit } from '../../src/domain/habit-edit';
import { buildTimeline } from '../../src/domain/habit-history';
import { normalizeHabitInput, type HabitInput } from '../../src/domain/planning';
import type { Habit } from '../../src/domain/types';
import { counterIds, event, makeHabit } from '../helpers';

const at = (day = '2026-01-10') => ({ day, now: `${day}T09:00:00.000Z`, newId: counterIds('e') });

function edit(habit: Habit, changes: Partial<HabitInput>, day?: string) {
  const { value, errors } = normalizeHabitInput({ ...habit, ...changes });
  expect(errors).toEqual({});
  return applyHabitEdit(habit, value, at(day));
}

describe('habit-edit', () => {
  it('ohne Änderung entstehen keine Ereignisse', () => {
    const habit = makeHabit();
    const result = edit(habit, { actionText: '  10 Minuten spazieren ' });
    expect(result.events).toEqual([]);
    expect(result.habit).toBe(habit);
  });

  it('Textänderungen landen als EDITED mit vorherigem Stand, nur die geänderten Felder', () => {
    const habit = makeHabit();
    const result = edit(habit, {
      minimumText: 'Schuhe anziehen',
      intention: { ifText: 'es nach dem Mittagessen ist', thenText: 'gehe ich los' },
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'EDITED',
      localDate: '2026-01-10',
      before: { minimumText: '2 Minuten vor die Tür', intention: null },
      after: { minimumText: 'Schuhe anziehen', intention: { ifText: 'es nach dem Mittagessen ist', thenText: 'gehe ich los' } },
    });
    expect(result.habit.minimumText).toBe('Schuhe anziehen');
    expect(result.habit.updatedAt).toBe('2026-01-10T09:00:00.000Z');
  });

  it('ein entfernter Wenn-dann-Satz fehlt danach am Habit', () => {
    const habit = makeHabit({ intention: { ifText: 'a', thenText: 'b' } });
    const result = edit(habit, { intention: { ifText: '', thenText: '' } });
    expect(result.habit.intention).toBeUndefined();
    expect(result.events[0]).toMatchObject({ before: { intention: { ifText: 'a', thenText: 'b' } }, after: { intention: null } });
  });

  it('Rhythmus und Gewicht bekommen eigene Ereignisse und gelten ab dem Änderungstag', () => {
    const habit = makeHabit({ weight: 1 });
    const activated = event('h1', '2026-01-01', 'ACTIVATED', 'DRAFT', 'ACTIVE');
    const result = edit(habit, { schedule: { type: 'WEEKDAYS', days: [1] }, weight: 3 });
    expect(result.events.map((e) => e.type)).toEqual(['SCHEDULE_CHANGED', 'WEIGHT_CHANGED']);
    const t = buildTimeline(result.habit, [activated, ...result.events]);
    expect(t.weightOn('2026-01-09')).toBe(1);
    expect(t.weightOn('2026-01-10')).toBe(3);
    expect(t.isPlannedOn('2026-01-09')).toBe(true); // Freitag, damals täglich
    expect(t.isPlannedOn('2026-01-10')).toBe(false); // Samstag, jetzt nur montags
  });
});
