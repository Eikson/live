import type { LocalDate } from './local-date';
import { matchesSchedule } from './schedule';
import type { Habit, HabitEvent, HabitEventType, HabitStatus, Schedule } from './types';

/**
 * Leitet zeitabhängige Werte (Rhythmus, Gewicht, Status) aus dem Änderungsprotokoll ab.
 *
 * Regel: Eine Änderung gilt ab ihrem lokalen Kalendertag. Für einen Tag d gilt der
 * `after`-Wert des letzten passenden Ereignisses mit localDate ≤ d. Liegt kein solches
 * Ereignis vor, gilt der `before`-Wert des ersten Ereignisses danach, sonst der aktuelle Wert.
 */
export interface HabitTimeline {
  readonly habit: Habit;
  statusOn(date: LocalDate): HabitStatus;
  scheduleOn(date: LocalDate): Schedule;
  weightOn(date: LocalDate): number;
  /** Aktiv (nicht DRAFT, nicht pausiert, nicht archiviert) und im damals gültigen Rhythmus. */
  isPlannedOn(date: LocalDate): boolean;
  /** Aktiv an diesem Tag, unabhängig vom Rhythmus. */
  isActiveOn(date: LocalDate): boolean;
}

const STATUS_EVENTS: ReadonlySet<HabitEventType> = new Set(['ACTIVATED', 'PAUSED', 'RESUMED', 'ARCHIVED']);
const STATUS_AFTER: Partial<Record<HabitEventType, HabitStatus>> = {
  ACTIVATED: 'ACTIVE',
  PAUSED: 'PAUSED',
  RESUMED: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
};

export function sortEvents(events: readonly HabitEvent[]): HabitEvent[] {
  return [...events].sort((a, b) =>
    a.localDate === b.localDate ? (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) : a.localDate < b.localDate ? -1 : 1,
  );
}

function valueAt<T>(
  events: readonly HabitEvent[],
  date: LocalDate,
  current: T,
  read: (e: HabitEvent, side: 'before' | 'after') => T | undefined,
): T {
  let last: HabitEvent | undefined;
  for (const e of events) {
    if (e.localDate <= date) last = e;
    else break;
  }
  if (last) return read(last, 'after') ?? current;
  const first = events[0];
  if (first) return read(first, 'before') ?? current;
  return current;
}

export function buildTimeline(habit: Habit, allEvents: readonly HabitEvent[]): HabitTimeline {
  const events = sortEvents(allEvents.filter((e) => e.habitId === habit.id));
  const scheduleEvents = events.filter((e) => e.type === 'SCHEDULE_CHANGED');
  const weightEvents = events.filter((e) => e.type === 'WEIGHT_CHANGED');
  const statusEvents = events.filter((e) => STATUS_EVENTS.has(e.type));

  const statusOn = (date: LocalDate): HabitStatus => {
    if (statusEvents.length === 0) {
      // Ohne Protokoll: aktiv ab activatedOn, sonst aktueller Status.
      if (habit.status === 'ACTIVE' && habit.activatedOn && date < habit.activatedOn) return 'DRAFT';
      return habit.status;
    }
    return valueAt<HabitStatus>(statusEvents, date, habit.status, (e, side) =>
      side === 'after' ? STATUS_AFTER[e.type] : (e.before as HabitStatus | undefined) ?? 'DRAFT',
    );
  };

  const scheduleOn = (date: LocalDate): Schedule =>
    valueAt<Schedule>(scheduleEvents, date, habit.schedule, (e, side) => e[side] as Schedule | undefined);

  const weightOn = (date: LocalDate): number =>
    valueAt<number>(weightEvents, date, habit.weight, (e, side) => e[side] as number | undefined);

  const isActiveOn = (date: LocalDate): boolean => statusOn(date) === 'ACTIVE';

  return {
    habit,
    statusOn,
    scheduleOn,
    weightOn,
    isActiveOn,
    isPlannedOn: (date) => isActiveOn(date) && matchesSchedule(scheduleOn(date), date),
  };
}
