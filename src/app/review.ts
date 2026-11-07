import type { ChangeSet, LiveData } from '../data/repository';
import { addDays, dateRange, minDate, type LocalDate } from '../domain/local-date';
import {
  asksAutomaticity,
  dueReviewWeek,
  isEmptyEntry,
  latestReviewWeek,
  nextReviewDay,
  normalizeReviewEntry,
  reviewSuggestions,
  snoozesAfterReview,
  type ReviewWeek,
  type SuggestionRule,
} from '../domain/review';
import { evaluatePatterns } from '../domain/scoring/patterns';
import type { Habit, Preferences, WeeklyReview, WeeklyReviewEntry } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive, type Derived } from './derived';
import { eventTime, statusChange } from './planning';
import { scoringContext } from './scoring';

export interface ReviewHabit {
  habit: Habit;
  /** „Heute nicht“ in der Rückblickswoche (Grundlage der ersten Vorschlagsregel) */
  notTodayCount: number;
}

export interface ReviewView {
  today: LocalDate;
  preferences: Preferences;
  /** Nächster Rückblickstag nach heute */
  nextDay: LocalDate;
  state: 'DUE' | 'COMPLETED' | 'SKIPPED' | 'NONE' | 'OFF';
  week: ReviewWeek;
  /** Habits im Aufbau: ausführliche Fragen */
  building: ReviewHabit[];
  /** Integrierte Aufbau-Habits und Gegen-Habits: kompakte Liste */
  compact: Habit[];
  /** In diesem Rückblick wird nach der Automatik gefragt (aktive Aufbau-Habits). */
  automaticity: boolean;
  /** Die Hinweis-Bedingung traf in dieser Woche zu (Abschnitt 4.5). */
  hint: boolean;
}

/** Habits, die in den Rückblick gehören: heute aktiv und schon vor dem Rückblickstag in der Woche aktiv. */
function reviewHabits(data: LiveData, derived: Derived, week: ReviewWeek, now: LocalDate): Habit[] {
  const before = dateRange(week.from, addDays(week.to, -1));
  return data.habits
    .filter((h) => {
      const t = derived.timeline(h);
      return t.isActiveOn(now) && before.some((d) => t.isActiveOn(d));
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function hasPatternIn(data: LiveData, derived: Derived, week: ReviewWeek, now: LocalDate): boolean {
  const ctx = scoringContext(data, derived);
  return dateRange(week.from, minDate(week.to, now)).some((d) => evaluatePatterns(ctx, d).due);
}

function notTodayIn(derived: Derived, habitId: string, week: ReviewWeek): number {
  let n = 0;
  for (const [d, c] of derived.checkInsOf(habitId)) if (d >= week.from && d <= week.to && c.outcome === 'NOT_DONE') n++;
  return n;
}

function buildView(data: LiveData, now: LocalDate): ReviewView {
  const prefs = data.preferences;
  const derived = derive(data, now);
  const latest = latestReviewWeek(now, prefs.reviewWeekday);
  const habits = reviewHabits(data, derived, latest, now);
  const isBuilding = (h: Habit) => h.kind === 'BUILD' && !derived.isIntegrated(h);
  const record = data.weeklyReviews.find((r) => r.weekStart === latest.weekStart);
  const due = dueReviewWeek({ today: now, enabled: prefs.reviewEnabled, weekday: prefs.reviewWeekday, reviews: data.weeklyReviews });
  const state: ReviewView['state'] = !prefs.reviewEnabled
    ? 'OFF'
    : record
      ? record.status
      : due && habits.length > 0
        ? 'DUE'
        : 'NONE';
  return {
    today: now,
    preferences: prefs,
    nextDay: nextReviewDay(now, prefs.reviewWeekday),
    state,
    week: latest,
    building: habits.filter(isBuilding).map((habit) => ({ habit, notTodayCount: notTodayIn(derived, habit.id, latest) })),
    compact: habits.filter((h) => !isBuilding(h)),
    automaticity: asksAutomaticity(data.weeklyReviews, latest.weekStart),
    hint: state === 'DUE' && hasPatternIn(data, derived, latest, now),
  };
}

export async function loadReviewView(ctx: AppContext): Promise<ReviewView> {
  return buildView(await ctx.repo.loadLive(), today(ctx.clock));
}

/** Für die Karte auf „Heute“: die anstehende Woche, sonst `undefined`. */
export function reviewCardFor(data: LiveData, derived: Derived, now: LocalDate): ReviewWeek | undefined {
  const prefs = data.preferences;
  const week = dueReviewWeek({ today: now, enabled: prefs.reviewEnabled, weekday: prefs.reviewWeekday, reviews: data.weeklyReviews });
  if (!week || reviewHabits(data, derived, week, now).length === 0) return undefined;
  return week;
}

export type ReviewResult = { ok: true; paused: string[] } | { ok: false; reason: 'NOT_DUE' };

function record(ctx: AppContext, week: ReviewWeek, status: WeeklyReview['status'], entries: WeeklyReviewEntry[]): WeeklyReview {
  const now = ctx.clock.now().toISOString();
  return { id: ctx.newId(), weekStart: week.weekStart, status, entries, createdAt: now, updatedAt: now };
}

/**
 * Schließt den Rückblick ab, alles in einer Transaktion: der Rückblick selbst, „pausieren“ als
 * Statuswechsel und die Ruhezeit abgelehnter Vorschläge. Leere Einträge werden nicht gespeichert.
 */
export async function completeReview(ctx: AppContext, weekStart: LocalDate, input: WeeklyReviewEntry[]): Promise<ReviewResult> {
  const data = await ctx.repo.loadLive();
  const now = today(ctx.clock);
  const view = buildView(data, now);
  if (view.state !== 'DUE' || view.week.weekStart !== weekStart) return { ok: false, reason: 'NOT_DUE' };

  const allowed = new Map([...view.building.map((b) => b.habit), ...view.compact].map((h) => [h.id, h]));
  const automaticityIds = new Set([...allowed.values()].filter((h) => h.kind === 'BUILD').map((h) => h.id));
  const entries = input
    .filter((e) => allowed.has(e.habitId))
    .map((e) => normalizeReviewEntry(e, { automaticity: view.automaticity && automaticityIds.has(e.habitId) }))
    .filter((e) => !isEmptyEntry(e));

  const rejected: { rule: SuggestionRule; habitId: string }[] = [];
  for (const b of view.building) {
    const entry = entries.find((e) => e.habitId === b.habit.id);
    const shown = reviewSuggestions({
      habitId: b.habit.id,
      notTodayCount: b.notTodayCount,
      ...(entry?.ease !== undefined ? { ease: entry.ease } : {}),
      ...(entry?.cueConsistency ? { cueConsistency: entry.cueConsistency } : {}),
      enabled: data.preferences.suggestionsEnabled,
      snoozes: data.preferences.suggestionSnoozes,
      today: now,
    });
    for (const s of shown) if (entry?.decision !== s.action) rejected.push({ rule: s.rule, habitId: b.habit.id });
  }

  const changes: ChangeSet = {
    weeklyReviews: [record(ctx, view.week, 'COMPLETED', entries)],
    preferences: {
      ...data.preferences,
      suggestionSnoozes: snoozesAfterReview(data.preferences.suggestionSnoozes, rejected, now),
      updatedAt: ctx.clock.now().toISOString(),
    },
    habits: [],
    addHabitEvents: [],
  };
  const at = eventTime(ctx, data);
  const paused: string[] = [];
  for (const e of entries) {
    if (e.decision !== 'PAUSE') continue;
    const change = statusChange(ctx, allowed.get(e.habitId)!, 'PAUSE', { day: now, now: at, buildingCount: 0, integrated: false });
    if ('reason' in change) continue;
    changes.habits!.push(change.habit);
    changes.addHabitEvents!.push(change.event);
    paused.push(e.habitId);
  }
  await ctx.repo.commit(changes);
  return { ok: true, paused };
}

/** „Jetzt überspringen“: Die Karte verschwindet bis zur nächsten Woche. Nichts ruht, nichts wird bewertet. */
export async function skipReview(ctx: AppContext, weekStart: LocalDate): Promise<ReviewResult> {
  const data = await ctx.repo.loadLive();
  const view = buildView(data, today(ctx.clock));
  if (view.state !== 'DUE' || view.week.weekStart !== weekStart) return { ok: false, reason: 'NOT_DUE' };
  await ctx.repo.commit({ weeklyReviews: [record(ctx, view.week, 'SKIPPED', [])] });
  return { ok: true, paused: [] };
}

/** Rückblick-Werte eines Habits für den Verlauf: abgeschlossene Rückblicke mit Wochenbeginn im Zeitraum. */
export function reviewValuesOf(
  reviews: readonly WeeklyReview[],
  habitId: string,
  from: LocalDate,
  to: LocalDate,
): { weekStart: LocalDate; entry: WeeklyReviewEntry }[] {
  return reviews
    .filter((r) => r.status === 'COMPLETED' && r.weekStart >= from && r.weekStart <= to)
    .flatMap((r) => {
      const entry = r.entries.find((e) => e.habitId === habitId);
      return entry && (entry.ease !== undefined || entry.cueConsistency || entry.automaticity) ? [{ weekStart: r.weekStart, entry }] : [];
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

