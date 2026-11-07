import { hintSnoozeUntil, shouldShowHintCard } from '../domain/scoring/patterns';
import type { LiveData } from '../data/repository';
import type { LocalDate } from '../domain/local-date';
import type { Habit } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import type { Derived } from './derived';
import { changeHabitStatus } from './planning';
import { updatePreferences } from './preferences';
import { patternsOn } from './scoring';

export type HintChoice = 'KEEP' | 'SMALLER' | 'CHANGE_CUE' | 'PAUSE' | 'EXCEPTIONS';

/**
 * Hinweiskarte (Abschnitt 4.5): nur bei Mustern, höchstens einmal pro 7 Tage.
 * Liefert die wählbaren Gewohnheiten (aktive Aufbau-Habits, integrierte zuerst) oder `undefined`.
 */
export function hintFor(data: LiveData, derived: Derived, now: LocalDate): { habits: Habit[] } | undefined {
  const due = patternsOn(data, derived, now).due;
  const show = shouldShowHintCard({
    due,
    today: now,
    ...(data.preferences.lastWarningCardAt ? { lastShownAt: data.preferences.lastWarningCardAt } : {}),
    ...(data.preferences.warningSnoozedUntil ? { snoozedUntil: data.preferences.warningSnoozedUntil } : {}),
  });
  if (!show) return undefined;
  const habits = data.habits
    .filter((h) => h.kind === 'BUILD' && derived.timeline(h).isActiveOn(now))
    .sort((a, b) => Number(derived.isIntegrated(b)) - Number(derived.isIntegrated(a)) || a.createdAt.localeCompare(b.createdAt));
  return { habits };
}

/** Merkt sich den Tag, an dem die Karte erschienen ist (Grundlage der 7-Tage-Sperre). */
export async function markHintShown(ctx: AppContext): Promise<void> {
  const now = today(ctx.clock);
  const prefs = await ctx.repo.getPreferences();
  if (prefs.lastWarningCardAt !== now) await updatePreferences(ctx, { lastWarningCardAt: now });
}

/** Jede Wahl blendet die Karte 7 Tage aus. „Pausieren“ pausiert die gewählte Gewohnheit. */
export async function chooseHint(ctx: AppContext, choice: HintChoice, habitId?: string): Promise<{ ok: boolean }> {
  if (choice === 'PAUSE') {
    if (!habitId) return { ok: false };
    const result = await changeHabitStatus(ctx, habitId, 'PAUSE');
    if (!result.ok) return { ok: false };
  }
  await updatePreferences(ctx, { warningSnoozedUntil: hintSnoozeUntil(today(ctx.clock)) });
  return { ok: true };
}
