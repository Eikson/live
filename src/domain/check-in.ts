import { appConfig } from './app-config';
import { diffDays, type LocalDate } from './local-date';
import type { CheckIn, CheckInOutcome, HabitKind, IsoTimestamp } from './types';

export const OUTCOMES_BY_KIND: Record<HabitKind, readonly CheckInOutcome[]> = {
  BUILD: ['DONE', 'ALTERNATIVE', 'NOT_DONE'],
  COUNTER_PROCRASTINATION: ['NO', 'PARTIAL', 'YES'],
  COUNTER_CUSTOM: ['KEPT', 'PARTIAL', 'BROKEN'],
  COUNTER_AVOIDANCE: ['RECORDED'],
};

export function isValidOutcome(kind: HabitKind, outcome: unknown): outcome is CheckInOutcome {
  return OUTCOMES_BY_KIND[kind].includes(outcome as CheckInOutcome);
}

/** Erfassen ist für heute und bis zu `checkInBackfillDays` Tage rückwirkend möglich, nie für die Zukunft. */
export function isWithinBackfill(date: LocalDate, today: LocalDate): boolean {
  const age = diffDays(date, today);
  return age >= 0 && age <= appConfig.checkInBackfillDays;
}

export interface CheckInInput {
  habitId: string;
  kind: HabitKind;
  localDate: LocalDate;
  outcome: CheckInOutcome;
  unplanned: boolean;
  minimal?: boolean;
  note?: string | null;
  avoidanceItemIds?: string[];
}

export type CheckInError = 'INVALID_OUTCOME' | 'OUT_OF_RANGE' | 'NOTE_TOO_LONG';

/**
 * Baut den Check-in für [habitId, localDate]. Gibt es schon einen, wird er aktualisiert
 * (gleiche ID), damit Korrekturen keine Duplikate erzeugen.
 * `minimal` ist nur bei DONE möglich und wird bei einem anderen Ergebnis zurückgesetzt.
 */
export function buildCheckIn(
  existing: CheckIn | undefined,
  input: CheckInInput,
  ctx: { today: LocalDate; now: IsoTimestamp; newId: () => string },
): { ok: true; checkIn: CheckIn } | { ok: false; error: CheckInError } {
  if (!isValidOutcome(input.kind, input.outcome)) return { ok: false, error: 'INVALID_OUTCOME' };
  if (!isWithinBackfill(input.localDate, ctx.today)) return { ok: false, error: 'OUT_OF_RANGE' };

  const noteInput = input.note === undefined ? existing?.note : input.note?.trim() || undefined;
  if (noteInput && noteInput.length > appConfig.textLimits.note) return { ok: false, error: 'NOTE_TOO_LONG' };

  const minimalRequested = input.minimal ?? (existing?.outcome === input.outcome ? existing.minimal : false);
  const checkIn: CheckIn = {
    id: existing?.id ?? ctx.newId(),
    habitId: input.habitId,
    localDate: input.localDate,
    outcome: input.outcome,
    minimal: input.outcome === 'DONE' ? minimalRequested : false,
    unplanned: input.unplanned,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  };
  if (input.kind === 'COUNTER_AVOIDANCE') checkIn.avoidanceItemIds = [...(input.avoidanceItemIds ?? [])];
  if (noteInput) checkIn.note = noteInput;
  return { ok: true, checkIn };
}
