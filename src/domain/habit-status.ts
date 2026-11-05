import { appConfig } from './app-config';
import type { Habit, HabitStatus } from './types';

export type StatusAction = 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'ARCHIVE';

const TRANSITIONS: Record<HabitStatus, Partial<Record<StatusAction, HabitStatus>>> = {
  DRAFT: { ACTIVATE: 'ACTIVE', ARCHIVE: 'ARCHIVED' },
  ACTIVE: { PAUSE: 'PAUSED', ARCHIVE: 'ARCHIVED' },
  PAUSED: { RESUME: 'ACTIVE', ARCHIVE: 'ARCHIVED' },
  ARCHIVED: {},
};

export type TransitionResult =
  | { ok: true; next: HabitStatus }
  | { ok: false; reason: 'INVALID_TRANSITION' | 'BUILD_LIMIT_REACHED' };

/** Ein Habit ist „im Aufbau“, wenn es ein aktives, noch nicht integriertes BUILD-Habit ist. */
export function isBuilding(habit: Habit, isIntegrated: (habit: Habit) => boolean): boolean {
  return habit.kind === 'BUILD' && habit.status === 'ACTIVE' && !isIntegrated(habit);
}

export function countBuilding(habits: readonly Habit[], isIntegrated: (habit: Habit) => boolean): number {
  return habits.filter((h) => isBuilding(h, isIntegrated)).length;
}

export function hasFreeBuildingSlot(habits: readonly Habit[], isIntegrated: (habit: Habit) => boolean): boolean {
  return countBuilding(habits, isIntegrated) < appConfig.maxBuildingHabits;
}

/**
 * Prüft einen Statuswechsel. Aktivieren und Fortsetzen eines BUILD-Habits brauchen einen
 * freien Platz im Aufbau. Gegen-Habits zählen nicht zur Grenze.
 */
export function transition(
  habit: Habit,
  action: StatusAction,
  ctx: { buildingCount: number },
): TransitionResult {
  const next = TRANSITIONS[habit.status][action];
  if (!next) return { ok: false, reason: 'INVALID_TRANSITION' };
  const needsSlot = habit.kind === 'BUILD' && (action === 'ACTIVATE' || action === 'RESUME');
  if (needsSlot && ctx.buildingCount >= appConfig.maxBuildingHabits) {
    return { ok: false, reason: 'BUILD_LIMIT_REACHED' };
  }
  return { ok: true, next };
}

export function isCounterHabit(habit: Pick<Habit, 'kind'>): boolean {
  return habit.kind !== 'BUILD';
}
