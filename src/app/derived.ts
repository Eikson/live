import type { LiveData } from '../data/repository';
import { buildTimeline, type HabitTimeline } from '../domain/habit-history';
import { countBuilding } from '../domain/habit-status';
import type { LocalDate } from '../domain/local-date';
import { integrationHistory, type IntegrationHistory } from '../domain/scoring/integration';
import type { CheckIn, Habit } from '../domain/types';

/**
 * Aus Rohdaten abgeleitete Sicht. Wird bei jedem Laden neu berechnet und nie gespeichert.
 */
export interface Derived {
  today: LocalDate;
  timeline(habit: Habit): HabitTimeline;
  integration(habit: Habit): IntegrationHistory;
  isIntegrated(habit: Habit): boolean;
  checkInsOf(habitId: string): Map<LocalDate, CheckIn>;
  exceptionDays: Set<LocalDate>;
  buildingCount: number;
}

export function derive(data: LiveData, today: LocalDate): Derived {
  const exceptionDays = new Set(data.dayRecords.filter((d) => d.exception).map((d) => d.localDate));
  const byHabit = new Map<string, Map<LocalDate, CheckIn>>();
  for (const c of data.checkIns) {
    let m = byHabit.get(c.habitId);
    if (!m) byHabit.set(c.habitId, (m = new Map()));
    m.set(c.localDate, c);
  }
  const timelines = new Map<string, HabitTimeline>();
  const integrations = new Map<string, IntegrationHistory>();

  const timeline = (habit: Habit): HabitTimeline => {
    let t = timelines.get(habit.id);
    if (!t) timelines.set(habit.id, (t = buildTimeline(habit, data.habitEvents)));
    return t;
  };
  const checkInsOf = (habitId: string) => byHabit.get(habitId) ?? new Map<LocalDate, CheckIn>();
  const integration = (habit: Habit): IntegrationHistory => {
    let i = integrations.get(habit.id);
    if (!i) {
      i = integrationHistory({ timeline: timeline(habit), checkIns: checkInsOf(habit.id), exceptionDays, today });
      integrations.set(habit.id, i);
    }
    return i;
  };
  const isIntegrated = (habit: Habit) => integration(habit).integrated;

  return {
    today,
    timeline,
    integration,
    isIntegrated,
    checkInsOf,
    exceptionDays,
    buildingCount: countBuilding(data.habits, isIntegrated),
  };
}
