import { addDays, weekdayOf, type LocalDate, type Weekday } from './local-date';
import type { Schedule } from './types';

export const DAILY: Schedule = { type: 'DAILY' };

export function matchesSchedule(schedule: Schedule, date: LocalDate): boolean {
  if (schedule.type === 'DAILY') return true;
  return schedule.days.includes(weekdayOf(date));
}

/** Nächster Tag nach `after` (exklusiv), der im Rhythmus liegt; `undefined` bei leerer Wochentagsliste. */
export function nextScheduledDate(schedule: Schedule, after: LocalDate): LocalDate | undefined {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(after, i);
    if (matchesSchedule(schedule, d)) return d;
  }
  return undefined;
}

export function normalizeWeekdays(days: readonly number[]): Weekday[] {
  return [...new Set(days.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

export function isValidSchedule(schedule: unknown): schedule is Schedule {
  if (!schedule || typeof schedule !== 'object') return false;
  const s = schedule as { type?: unknown; days?: unknown };
  if (s.type === 'DAILY') return true;
  if (s.type !== 'WEEKDAYS' || !Array.isArray(s.days) || s.days.length === 0) return false;
  return s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}
