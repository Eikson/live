import { sortAvoidanceItems } from '../domain/avoidance';
import { buildCheckIn, isWithinBackfill, type CheckInError } from '../domain/check-in';
import {
  applyDayRecordChange,
  COUNTER_ORDER,
  needsCounterHint,
  type DayRecordError,
} from '../domain/evening';
import { addDays, dateRange, diffDays, type LocalDate } from '../domain/local-date';
import { appConfig } from '../domain/app-config';
import type { AvoidanceItem, CheckIn, CheckInOutcome, DayRecord, ExceptionReason, Habit } from '../domain/types';
import type { ChangeSet } from '../data/repository';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export interface EveningHabit {
  habit: Habit;
  checkIn?: CheckIn;
}

export interface EveningView {
  today: LocalDate;
  /** Der gewählte Tag: heute oder bis zu 7 Tage zurück. */
  day: LocalDate;
  /** Wählbare Tage, neuester zuerst. */
  days: LocalDate[];
  record?: DayRecord;
  procrastination?: EveningHabit;
  avoidance?: EveningHabit & { items: AvoidanceItem[] };
  customs: EveningHabit[];
  /** Normale Habits, die an diesem Tag geplant sind und noch keine Angabe haben. */
  open: Habit[];
  /** Mehr als 5 aktive Gegen-Habits: Der Abend-Check-in dauert dann länger. */
  softHint: boolean;
}

/** Aktive Gegen-Habits an einem Tag, in der Reihenfolge des Abend-Check-ins. */
function countersOn(habits: readonly Habit[], isActive: (h: Habit) => boolean): Habit[] {
  return habits
    .filter((h) => h.kind !== 'BUILD' && isActive(h))
    .sort(
      (a, b) =>
        COUNTER_ORDER[a.kind as keyof typeof COUNTER_ORDER] - COUNTER_ORDER[b.kind as keyof typeof COUNTER_ORDER] ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export async function loadEveningView(ctx: AppContext, requestedDay?: LocalDate): Promise<EveningView> {
  const data = await ctx.repo.loadLive();
  const now = today(ctx.clock);
  const day = requestedDay && isWithinBackfill(requestedDay, now) ? requestedDay : now;
  const derived = derive(data, day);
  const entry = (habit: Habit): EveningHabit => {
    const checkIn = derived.checkInsOf(habit.id).get(day);
    return { habit, ...(checkIn ? { checkIn } : {}) };
  };

  const counters = countersOn(data.habits, (h) => derived.timeline(h).isActiveOn(day));
  const procrastination = counters.find((h) => h.kind === 'COUNTER_PROCRASTINATION');
  const avoidance = counters.find((h) => h.kind === 'COUNTER_AVOIDANCE');
  const view: EveningView = {
    today: now,
    day,
    days: dateRange(addDays(now, -appConfig.checkInBackfillDays), now).reverse(),
    customs: counters.filter((h) => h.kind === 'COUNTER_CUSTOM').map(entry),
    open: data.habits
      .filter((h) => h.kind === 'BUILD' && derived.timeline(h).isPlannedOn(day) && !derived.checkInsOf(h.id).has(day))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    softHint: needsCounterHint(data.habits.filter((h) => h.kind !== 'BUILD' && h.status === 'ACTIVE').length),
  };
  const record = data.dayRecords.find((r) => r.localDate === day);
  if (record) view.record = record;
  if (procrastination) view.procrastination = entry(procrastination);
  if (avoidance) {
    const e = entry(avoidance);
    const checked = new Set(e.checkIn?.avoidanceItemIds ?? []);
    // Ausgeblendete Einträge bleiben sichtbar, wenn sie an diesem Tag abgehakt wurden.
    const items = sortAvoidanceItems(data.avoidanceItems.filter((i) => i.active || checked.has(i.id)));
    view.avoidance = { ...e, items };
  }
  return view;
}

export interface CloseDayInput {
  day: LocalDate;
  /** `null` = übersprungen bzw. zurückgenommen. */
  mood: number | null;
  energy: number | null;
  /** Antworten für Gegen-Habits und offene Habits; nicht beantwortete fehlen einfach. */
  answers: { habitId: string; outcome: CheckInOutcome }[];
  /** Abgehakte Einträge der Ausweichliste; leer heißt „nichts davon“. */
  avoidanceItemIds: string[];
}

export type CloseDayResult =
  | { ok: true }
  | { ok: false; error: CheckInError | DayRecordError | 'NOT_ACTIVE' };

/**
 * Schließt einen Tag ab: Stimmung, Energie und alle Antworten werden in **einer** Transaktion
 * gespeichert. Das Ausweichverhalten ist damit beantwortet, auch wenn nichts abgehakt ist.
 * Bestehende Angaben desselben Tages werden aktualisiert, nicht verdoppelt.
 */
export async function closeDay(ctx: AppContext, input: CloseDayInput): Promise<CloseDayResult> {
  const day = today(ctx.clock);
  if (!isWithinBackfill(input.day, day)) return { ok: false, error: 'OUT_OF_RANGE' };
  const data = await ctx.repo.loadLive();
  const derived = derive(data, input.day);
  const now = ctx.clock.now().toISOString();
  const checkIns: CheckIn[] = [];

  const add = (habit: Habit, outcome: CheckInOutcome, avoidanceItemIds?: string[]): CheckInError | 'NOT_ACTIVE' | undefined => {
    const timeline = derived.timeline(habit);
    if (!timeline.isActiveOn(input.day)) return 'NOT_ACTIVE';
    const built = buildCheckIn(
      derived.checkInsOf(habit.id).get(input.day),
      {
        habitId: habit.id,
        kind: habit.kind,
        localDate: input.day,
        outcome,
        unplanned: !timeline.isPlannedOn(input.day),
        ...(avoidanceItemIds ? { avoidanceItemIds } : {}),
      },
      { today: day, now, newId: ctx.newId },
    );
    if (!built.ok) return built.error;
    checkIns.push(built.checkIn);
    return undefined;
  };

  for (const answer of input.answers) {
    const habit = data.habits.find((h) => h.id === answer.habitId);
    if (!habit || habit.kind === 'COUNTER_AVOIDANCE') continue;
    const error = add(habit, answer.outcome);
    if (error) return { ok: false, error };
  }
  const avoidance = countersOn(data.habits, (h) => derived.timeline(h).isActiveOn(input.day)).find(
    (h) => h.kind === 'COUNTER_AVOIDANCE',
  );
  if (avoidance) {
    const known = new Set(data.avoidanceItems.map((i) => i.id));
    const error = add(avoidance, 'RECORDED', [...new Set(input.avoidanceItemIds)].filter((id) => known.has(id)));
    if (error) return { ok: false, error };
  }

  const existing = data.dayRecords.find((r) => r.localDate === input.day);
  const record = applyDayRecordChange(existing, input.day, { mood: input.mood, energy: input.energy, close: true }, now);
  if (!record.ok) return record;
  const changes: ChangeSet = { checkIns };
  if (record.record) changes.dayRecords = [record.record];
  await ctx.repo.commit(changes);
  return { ok: true };
}

export type ExceptionResult = { ok: true } | { ok: false; error: DayRecordError | 'OUT_OF_RANGE' };

/** Ausnahmetage lassen sich für heute und jeden früheren Tag setzen, nicht für die Zukunft. */
function isPastOrToday(date: LocalDate, now: LocalDate): boolean {
  return diffDays(date, now) >= 0;
}

/**
 * Markiert einen Ausnahmetag (krank, Urlaub, anderes). Er zählt in keinem Durchschnitt, keiner Quote
 * und keiner Hinweislogik. Angaben des Tages bleiben gespeichert.
 */
export async function setException(
  ctx: AppContext,
  input: { day: LocalDate; reason: ExceptionReason; note?: string },
): Promise<ExceptionResult> {
  if (!isPastOrToday(input.day, today(ctx.clock))) return { ok: false, error: 'OUT_OF_RANGE' };
  const data = await ctx.repo.loadLive();
  const existing = data.dayRecords.find((r) => r.localDate === input.day);
  const exception = { reason: input.reason, ...(input.note !== undefined ? { note: input.note } : {}) };
  const result = applyDayRecordChange(existing, input.day, { exception }, ctx.clock.now().toISOString());
  if (!result.ok) return result;
  await ctx.repo.commit({ dayRecords: result.record ? [result.record] : [] });
  return { ok: true };
}

/** Hebt einen Ausnahmetag auf. Bleibt vom Tagesdatensatz nichts übrig, wird er entfernt. */
export async function clearException(ctx: AppContext, day: LocalDate): Promise<ExceptionResult> {
  if (!isPastOrToday(day, today(ctx.clock))) return { ok: false, error: 'OUT_OF_RANGE' };
  const data = await ctx.repo.loadLive();
  const existing = data.dayRecords.find((r) => r.localDate === day);
  if (!existing?.exception) return { ok: true };
  const result = applyDayRecordChange(existing, day, { exception: null }, ctx.clock.now().toISOString());
  if (!result.ok) return result;
  await ctx.repo.commit(result.record ? { dayRecords: [result.record] } : { removeDayRecords: [day] });
  return { ok: true };
}
