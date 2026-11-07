import { de } from '../i18n/de';
import { dayOfMonth, monthIndex, weekdayOf, type LocalDate, type Weekday } from '../domain/local-date';
import type { Cue, Schedule } from '../domain/types';

/** „Do, 5. Nov.“ */
export function formatDayShort(date: LocalDate): string {
  return `${de.date.weekdaysShort[weekdayOf(date)]}, ${dayOfMonth(date)}. ${de.date.monthsShort[monthIndex(date)]}`;
}

/** Auslöser als kurze Zeile, z. B. „Nach dem Mittagessen“ oder „Vor der Pause · 12:30 Uhr“. */
export function formatCue(cue: Cue): string {
  if (cue.type !== 'TIME' || !cue.time) return cue.description;
  const time = `${cue.time} Uhr`;
  return cue.description ? `${cue.description} · ${time}` : `Um ${time}`;
}

/** „Do“ */
export function formatWeekdayShort(date: LocalDate): string {
  return de.date.weekdaysShort[weekdayOf(date)] ?? '';
}

/** Wochentage in deutscher Reihenfolge, Montag zuerst. */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** „täglich“ oder „Mo, Mi, Fr“. */
export function formatSchedule(schedule: Schedule): string {
  if (schedule.type === 'DAILY') return de.plan.daily;
  return WEEK_ORDER.filter((d) => schedule.days.includes(d))
    .map((d) => de.date.weekdaysShort[d])
    .join(', ');
}

/** Eine Nachkommastelle mit deutschem Komma, z. B. „4,6“. */
export function formatDecimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** „5. Nov.“ */
export function formatDayMonth(date: LocalDate): string {
  return `${dayOfMonth(date)}. ${de.date.monthsShort[monthIndex(date)]}`;
}

/** „November 2026“ aus „2026-11“. */
export function formatMonth(month: string): string {
  return `${de.date.monthsLong[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
