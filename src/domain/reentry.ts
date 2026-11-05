import { appConfig } from './app-config';
import type { HabitTimeline } from './habit-history';
import { addDays, dateRange, diffDays, maxDate, type LocalDate } from './local-date';
import type { HabitEvent, HabitEventType } from './types';

/** Ereignisse, ab denen ein Habit (wieder) neu läuft. */
const RESTART_EVENTS: ReadonlySet<HabitEventType> = new Set(['ACTIVATED', 'RESUMED', 'REENTERED']);

export type ReentryChoice = 'CONTINUE' | 'SMALLER' | 'CHANGE_CUE' | 'PAUSE';

export interface ReentryHabitInput {
  timeline: HabitTimeline;
  /** Ereignisse dieses Habits */
  events: readonly HabitEvent[];
  /** Tage mit einer Angabe zu diesem Habit */
  checkInDates: readonly LocalDate[];
}

export interface ReentryInput {
  today: LocalDate;
  /** Habits, die heute aktiv sind */
  habits: readonly ReentryHabitInput[];
  /** Alle Tage mit irgendeiner Angabe: Check-ins aller Habits, Befinden, Ausnahmetage */
  entryDates: readonly LocalDate[];
  exceptionDays: ReadonlySet<LocalDate>;
}

export interface Reentry {
  /** Letzte Angabe oder letzter Neustart über alle Habits; dient auch als Schlüssel fürs Wegklicken. */
  since: LocalDate;
  habitIds: string[];
}

function latest(dates: Iterable<LocalDate>, today: LocalDate): LocalDate | undefined {
  let out: LocalDate | undefined;
  for (const d of dates) if (d <= today) out = out ? maxDate(out, d) : d;
  return out;
}

/**
 * Wiedereinstieg (docs/entscheidungen.md, E-019): Seit der letzten Angabe irgendeiner Art liegen
 * mindestens `daysWithoutAnyEntry` Tage. Ein Habit ist betroffen, wenn seit seiner letzten Angabe
 * bzw. seinem letzten Neustart mindestens `minMissedPlannedOpportunities` geplante Tage ohne
 * Angabe vergangen sind (Ausnahmetage zählen nicht). Heute zählt dabei nicht mit.
 */
export function findReentry(input: ReentryInput): Reentry | undefined {
  const { today } = input;
  const { daysWithoutAnyEntry, minMissedPlannedOpportunities } = appConfig.recovery;

  const perHabit = input.habits.map((h) => ({
    h,
    since: latest(
      [
        ...h.checkInDates,
        ...h.events.filter((e) => RESTART_EVENTS.has(e.type)).map((e) => e.localDate),
        ...(h.timeline.habit.activatedOn ? [h.timeline.habit.activatedOn] : []),
      ],
      today,
    ),
  }));
  const since = latest(
    [...input.entryDates, ...perHabit.flatMap((p) => (p.since ? [p.since] : []))],
    today,
  );
  if (!since || diffDays(since, today) < daysWithoutAnyEntry) return undefined;

  const habitIds = perHabit
    .filter(({ h, since: s }) => {
      if (!s || s >= addDays(today, -1)) return false;
      const missed = dateRange(addDays(s, 1), addDays(today, -1)).filter(
        (d) => h.timeline.isPlannedOn(d) && !input.exceptionDays.has(d),
      ).length;
      return missed >= minMissedPlannedOpportunities;
    })
    .map(({ h }) => h.timeline.habit.id);
  return habitIds.length > 0 ? { since, habitIds } : undefined;
}
