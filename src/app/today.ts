import { isWithinBackfill } from '../domain/check-in';
import type { ReviewWeek } from '../domain/review';
import { addDays, dateRange, type LocalDate } from '../domain/local-date';
import { appConfig } from '../domain/app-config';
import { isEveningCardTime } from '../domain/evening';
import { findReentry } from '../domain/reentry';
import { nextScheduledDate } from '../domain/schedule';
import type { CheckIn, Habit, Preferences } from '../domain/types';
import { minutesOfDay, today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';
import { hintFor } from './hint';
import { reviewCardFor } from './review';

export interface TodayCard {
  habit: Habit;
  building: boolean;
  /** An diesem Tag laut Rhythmus geplant. Sonst nur „Trotzdem gemacht“. */
  planned: boolean;
  /** Nur für nicht geplante Karten: der nächste geplante Tag nach `day`. */
  nextDate?: LocalDate;
  checkIn?: CheckIn;
}

export interface TodayView {
  today: LocalDate;
  /** Der angezeigte Tag: heute oder bis zu 7 Tage zurück (Nachtragen). */
  day: LocalDate;
  /** Wählbare Tage, neuester zuerst. */
  days: LocalDate[];
  preferences: Preferences;
  /** Geplante Karten zuerst (Habits im Aufbau oben), danach nicht geplante. */
  cards: TodayCard[];
  /** Wiedereinstiegskarte; nur für heute, nicht beim Nachtragen. */
  reentry?: { since: LocalDate; habits: Habit[] };
  /** Hinweiskarte bei Mustern (Abschnitt 4.5); nur für heute. */
  hint?: { habits: Habit[] };
  /** Anstehender Wochenrückblick; nur für heute. */
  review?: ReviewWeek;
  /** Abend-Karte: nur für heute, ab der eingestellten Uhrzeit, solange der Tag nicht abgeschlossen ist. */
  eveningCard: boolean;
  /** Der angezeigte Tag ist abgeschlossen. */
  dayClosed: boolean;
}

/**
 * Sicht für „Heute“. Gegen-Habits erscheinen hier nicht als Karte, sondern nur im
 * Abend-Check-in (docs/entscheidungen.md, E-003). Kein Score auf „Heute“.
 */
export async function loadTodayView(ctx: AppContext, requestedDay?: LocalDate): Promise<TodayView> {
  const data = await ctx.repo.loadLive();
  const now = today(ctx.clock);
  const day = requestedDay && isWithinBackfill(requestedDay, now) ? requestedDay : now;
  const derived = derive(data, day);

  const cards: TodayCard[] = data.habits
    .filter((h) => h.kind === 'BUILD' && derived.timeline(h).isActiveOn(day))
    .map((habit) => {
      const timeline = derived.timeline(habit);
      const planned = timeline.isPlannedOn(day);
      const checkIn = derived.checkInsOf(habit.id).get(day);
      const nextDate = planned ? undefined : nextScheduledDate(timeline.scheduleOn(day), day);
      return {
        habit,
        building: !derived.isIntegrated(habit),
        planned,
        ...(nextDate ? { nextDate } : {}),
        ...(checkIn ? { checkIn } : {}),
      };
    })
    .sort(
      (a, b) =>
        Number(b.planned) - Number(a.planned) ||
        Number(b.building) - Number(a.building) ||
        a.habit.createdAt.localeCompare(b.habit.createdAt),
    );

  const days = dateRange(addDays(now, -appConfig.checkInBackfillDays), now).reverse();
  const dayClosed = data.dayRecords.some((r) => r.localDate === day && r.closedAt !== undefined);
  const view: TodayView = {
    today: now,
    day,
    days,
    preferences: data.preferences,
    cards,
    dayClosed,
    eveningCard: day === now && !dayClosed && isEveningCardTime(minutesOfDay(ctx.clock), data.preferences.eveningCardFrom),
  };
  if (day === now) {
    const active = data.habits.filter((h) => h.kind === 'BUILD' && derived.timeline(h).isActiveOn(now));
    const reentry = findReentry({
      today: now,
      habits: active.map((h) => ({
        timeline: derived.timeline(h),
        events: data.habitEvents.filter((e) => e.habitId === h.id),
        checkInDates: [...derived.checkInsOf(h.id).keys()],
      })),
      entryDates: [...data.checkIns.map((c) => c.localDate), ...data.dayRecords.map((d) => d.localDate)],
      exceptionDays: derived.exceptionDays,
    });
    if (reentry) view.reentry = { since: reentry.since, habits: active.filter((h) => reentry.habitIds.includes(h.id)) };
    const hint = hintFor(data, derived, now);
    if (hint) view.hint = hint;
    const review = reviewCardFor(data, derived, now);
    if (review) view.review = review;
  }
  return view;
}
