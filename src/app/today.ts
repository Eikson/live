import { isWithinBackfill } from '../domain/check-in';
import { addDays, dateRange, type LocalDate } from '../domain/local-date';
import { appConfig } from '../domain/app-config';
import { nextScheduledDate } from '../domain/schedule';
import type { CheckIn, Habit, Preferences } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

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
  return { today: now, day, days, preferences: data.preferences, cards };
}
