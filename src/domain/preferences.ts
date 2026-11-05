import { appConfig } from './app-config';
import type { Weekday } from './local-date';
import type { IsoTimestamp, Preferences } from './types';

export function defaultPreferences(now: IsoTimestamp): Preferences {
  return {
    id: 'preferences',
    theme: 'system',
    reviewEnabled: true,
    reviewWeekday: appConfig.review.defaultWeekday as Weekday,
    suggestionsEnabled: true,
    eveningCardFrom: appConfig.eveningCardFrom,
    backupReminderEnabled: true,
    suggestionSnoozes: {},
    updatedAt: now,
  };
}

/** Ergänzt fehlende Felder (z. B. aus älteren Datensätzen) mit Standardwerten. */
export function withPreferenceDefaults(stored: Partial<Preferences> | undefined, now: IsoTimestamp): Preferences {
  return { ...defaultPreferences(now), ...(stored ?? {}), id: 'preferences' };
}
