import type { LocalDate } from '../domain/local-date';
import type { CheckIn, Habit, Preferences } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export interface TodayCard {
  habit: Habit;
  building: boolean;
  checkIn?: CheckIn;
}

export interface TodayView {
  today: LocalDate;
  preferences: Preferences;
  /** Je heute geplantem Habit eine Karte; Habits im Aufbau zuerst. */
  cards: TodayCard[];
}

/**
 * Sicht für „Heute“. Gegen-Habits erscheinen hier nicht als Karte, sondern nur im
 * Abend-Check-in (docs/entscheidungen.md, E-003). Kein Score auf „Heute“.
 */
export async function loadTodayView(ctx: AppContext): Promise<TodayView> {
  const data = await ctx.repo.loadLive();
  const day = today(ctx.clock);
  const derived = derive(data, day);

  const cards: TodayCard[] = data.habits
    .filter((h) => h.kind === 'BUILD' && h.status === 'ACTIVE' && derived.timeline(h).isPlannedOn(day))
    .map((habit) => {
      const checkIn = derived.checkInsOf(habit.id).get(day);
      return { habit, building: !derived.isIntegrated(habit), ...(checkIn ? { checkIn } : {}) };
    })
    .sort((a, b) => Number(b.building) - Number(a.building) || a.habit.createdAt.localeCompare(b.habit.createdAt));

  return { today: day, preferences: data.preferences, cards };
}
