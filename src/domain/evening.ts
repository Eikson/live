import { appConfig } from './app-config';
import type { DayRecord, ExceptionReason, HabitKind, IsoTimestamp } from './types';
import type { LocalDate } from './local-date';

/** Stimmung und Energie: ganze Zahlen 1–5, beide überspringbar. */
export const RATING_VALUES = [1, 2, 3, 4, 5] as const;
export const EXCEPTION_REASONS: readonly ExceptionReason[] = ['SICK', 'VACATION', 'OTHER'];

/** Die beiden vordefinierten Gegen-Habits; es gibt jeweils höchstens eins (nicht archiviert). */
export const PREDEFINED_COUNTER_KINDS = ['COUNTER_PROCRASTINATION', 'COUNTER_AVOIDANCE'] as const;
export type PredefinedCounterKind = (typeof PREDEFINED_COUNTER_KINDS)[number];

export function isRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function isExceptionReason(value: unknown): value is ExceptionReason {
  return EXCEPTION_REASONS.includes(value as ExceptionReason);
}

/** Reihenfolge im Abend-Check-in: Aufschieben, Ausweichen, eigene Gegen-Habits. */
export const COUNTER_ORDER: Record<Exclude<HabitKind, 'BUILD'>, number> = {
  COUNTER_PROCRASTINATION: 0,
  COUNTER_AVOIDANCE: 1,
  COUNTER_CUSTOM: 2,
};

/** Ab mehr als `counterHabitSoftHintAbove` aktiven Gegen-Habits erscheint ein ruhiger Hinweis. */
export function needsCounterHint(activeCounterCount: number): boolean {
  return activeCounterCount > appConfig.counterHabitSoftHintAbove;
}

export type DayRecordError = 'INVALID_RATING' | 'INVALID_REASON' | 'NOTE_TOO_LONG';

export interface DayRecordChange {
  /** `null` entfernt den Wert, `undefined` lässt ihn unverändert. */
  mood?: number | null;
  energy?: number | null;
  /** `null` hebt den Ausnahmetag auf. */
  exception?: { reason: ExceptionReason; note?: string } | null;
  /** Setzt `closedAt` (Tag abgeschlossen). */
  close?: boolean;
}

/**
 * Baut den Tagesdatensatz aus dem bestehenden und der Änderung. Liefert `record: undefined`,
 * wenn nichts mehr übrig ist (dann wird der Datensatz entfernt).
 */
export function applyDayRecordChange(
  existing: DayRecord | undefined,
  localDate: LocalDate,
  change: DayRecordChange,
  now: IsoTimestamp,
): { ok: true; record: DayRecord | undefined } | { ok: false; error: DayRecordError } {
  for (const v of [change.mood, change.energy]) {
    if (v !== undefined && v !== null && !isRating(v)) return { ok: false, error: 'INVALID_RATING' };
  }
  const next: DayRecord = { localDate, updatedAt: now };
  const mood = change.mood === undefined ? existing?.mood : (change.mood ?? undefined);
  const energy = change.energy === undefined ? existing?.energy : (change.energy ?? undefined);
  if (mood !== undefined) next.mood = mood;
  if (energy !== undefined) next.energy = energy;

  if (change.exception === undefined) {
    if (existing?.exception) next.exception = existing.exception;
  } else if (change.exception !== null) {
    if (!isExceptionReason(change.exception.reason)) return { ok: false, error: 'INVALID_REASON' };
    const note = change.exception.note?.trim();
    if (note && note.length > appConfig.textLimits.note) return { ok: false, error: 'NOTE_TOO_LONG' };
    next.exception = { reason: change.exception.reason, ...(note ? { note } : {}) };
  }

  const closedAt = change.close ? now : existing?.closedAt;
  if (closedAt) next.closedAt = closedAt;

  const empty = next.mood === undefined && next.energy === undefined && !next.exception && !next.closedAt;
  return { ok: true, record: empty ? undefined : next };
}

/** Handlungstexte der vordefinierten Gegen-Habits (Spezifikation, Abschnitt 4). */
export const PREDEFINED_COUNTER_TEXT: Record<PredefinedCounterKind, string> = {
  COUNTER_PROCRASTINATION: 'Nicht aufgeschoben',
  COUNTER_AVOIDANCE: 'Kein Ausweichverhalten',
};

export function isPredefinedCounterKind(kind: HabitKind): kind is PredefinedCounterKind {
  return (PREDEFINED_COUNTER_KINDS as readonly HabitKind[]).includes(kind);
}

/** Ab `from` (`HH:MM`) erscheint die Abend-Karte auf „Heute“. Ungültige Angaben fallen auf 18:00 zurück. */
export function isEveningCardTime(minutesOfDay: number, from: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(from) ?? /^(\d\d):(\d\d)$/.exec(appConfig.eveningCardFrom)!;
  return minutesOfDay >= Number(match[1]) * 60 + Number(match[2]);
}
