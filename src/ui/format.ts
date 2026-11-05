import { de } from '../i18n/de';
import { dayOfMonth, monthIndex, weekdayOf, type LocalDate } from '../domain/local-date';
import type { Cue } from '../domain/types';

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
