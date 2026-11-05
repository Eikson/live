import { buildCheckIn, type CheckInError } from '../domain/check-in';
import { buildTimeline } from '../domain/habit-history';
import type { LocalDate } from '../domain/local-date';
import type { CheckIn, CheckInOutcome } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';

export interface RecordCheckInInput {
  habitId: string;
  localDate: LocalDate;
  /** Fehlt das Ergebnis, bleibt das bestehende (nur Minimalversion/Notiz ändern). */
  outcome?: CheckInOutcome;
  minimal?: boolean;
  /** `null` entfernt die Notiz, `undefined` lässt sie unverändert. */
  note?: string | null;
  avoidanceItemIds?: string[];
}

export type RecordCheckInResult =
  | { ok: true; checkIn: CheckIn }
  | { ok: false; error: CheckInError | 'NOT_FOUND' | 'NOT_ACTIVE' | 'NO_OUTCOME' };

/**
 * Erfasst oder korrigiert den Check-in eines Tages. Lesen und Schreiben laufen in einer
 * Transaktion; ein Doppeltipp erzeugt daher nie zwei Einträge.
 * „Heute nicht“ und fehlende Angaben haben keine weiteren Folgen: Es entstehen keine
 * zusätzlichen Datensätze.
 */
export async function recordCheckIn(ctx: AppContext, input: RecordCheckInInput): Promise<RecordCheckInResult> {
  const habit = await ctx.repo.getHabit(input.habitId);
  if (!habit) return { ok: false, error: 'NOT_FOUND' };
  const data = await ctx.repo.loadLive();
  const timeline = buildTimeline(habit, data.habitEvents.filter((e) => e.habitId === habit.id));
  if (!timeline.isActiveOn(input.localDate)) return { ok: false, error: 'NOT_ACTIVE' };

  const day = today(ctx.clock);
  const now = ctx.clock.now().toISOString();
  // Wird im Transaktions-Callback gesetzt; der Cast verhindert eine zu enge Typ-Eingrenzung.
  let failure = undefined as RecordCheckInResult | undefined;

  const stored = await ctx.repo.upsertCheckIn(habit.id, input.localDate, (existing) => {
    const outcome = input.outcome ?? existing?.outcome;
    if (!outcome) {
      failure = { ok: false, error: 'NO_OUTCOME' };
      return null;
    }
    const built = buildCheckIn(
      existing,
      {
        habitId: habit.id,
        kind: habit.kind,
        localDate: input.localDate,
        outcome,
        unplanned: !timeline.isPlannedOn(input.localDate),
        ...(input.minimal !== undefined ? { minimal: input.minimal } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.avoidanceItemIds ? { avoidanceItemIds: input.avoidanceItemIds } : {}),
      },
      { today: day, now, newId: ctx.newId },
    );
    if (!built.ok) {
      failure = { ok: false, error: built.error };
      return null;
    }
    return built.checkIn;
  });

  if (failure) return failure;
  return { ok: true, checkIn: stored as CheckIn };
}
