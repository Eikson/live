import { appConfig } from './app-config';
import { diffDays, toLocalDate, type LocalDate } from './local-date';
import type { Preferences } from './types';

/** Kalendertag des letzten Exports oder, ohne Export, des ersten Starts. */
export function backupReference(prefs: Preferences): LocalDate | undefined {
  const ref = prefs.lastBackupAt ?? prefs.onboardingCompletedAt;
  return ref ? toLocalDate(new Date(ref)) : undefined;
}

/**
 * Der Backup-Hinweis erscheint, wenn das letzte Backup älter als 14 Tage ist
 * (ohne Export: gerechnet ab dem ersten Start). Abschaltbar.
 */
export function backupReminderDue(prefs: Preferences, today: LocalDate): boolean {
  if (!prefs.backupReminderEnabled) return false;
  const ref = backupReference(prefs);
  return ref !== undefined && diffDays(ref, today) > appConfig.backupReminderDays;
}
