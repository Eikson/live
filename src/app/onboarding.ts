import { transition } from '../domain/habit-status';
import {
  hasErrors,
  normalizeGoalInput,
  normalizeHabitInput,
  type FieldErrors,
  type GoalInput,
  type HabitField,
  type HabitInput,
} from '../domain/planning';
import type { Goal, Habit, HabitEvent } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export interface OnboardingInput {
  goal: GoalInput;
  habit: Omit<HabitInput, 'kind' | 'goalId'>;
}

export type OnboardingResult =
  | { ok: true; goalId: string; habitId: string; status: Habit['status'] }
  | { ok: false; goalErrors: FieldErrors<'title' | 'why' | 'successSignal'>; habitErrors: FieldErrors<HabitField> };

/**
 * Legt Ziel und erstes Habit an, aktiviert es (falls ein Platz im Aufbau frei ist)
 * und markiert den ersten Start als abgeschlossen – alles in einer Transaktion.
 */
export async function completeOnboarding(ctx: AppContext, input: OnboardingInput): Promise<OnboardingResult> {
  const goalNorm = normalizeGoalInput(input.goal);
  const habitNorm = normalizeHabitInput({ ...input.habit, kind: 'BUILD' });
  if (hasErrors(goalNorm.errors) || hasErrors(habitNorm.errors)) {
    return { ok: false, goalErrors: goalNorm.errors, habitErrors: habitNorm.errors };
  }

  const data = await ctx.repo.loadLive();
  const day = today(ctx.clock);
  const now = ctx.clock.now().toISOString();
  const derived = derive(data, day);

  const goal: Goal = { id: ctx.newId(), ...goalNorm.value, status: 'ACTIVE', createdAt: now, updatedAt: now };
  const draft: Habit = { id: ctx.newId(), ...habitNorm.value, goalId: goal.id, status: 'DRAFT', createdAt: now, updatedAt: now };
  const events: HabitEvent[] = [
    { id: ctx.newId(), habitId: draft.id, localDate: day, at: now, type: 'CREATED', after: 'DRAFT' },
  ];

  let habit = draft;
  const activation = transition(draft, 'ACTIVATE', { buildingCount: derived.buildingCount });
  if (activation.ok) {
    habit = { ...draft, status: activation.next, activatedOn: day };
    events.push({ id: ctx.newId(), habitId: habit.id, localDate: day, at: now, type: 'ACTIVATED', before: 'DRAFT', after: 'ACTIVE' });
  }

  await ctx.repo.commit({
    goals: [goal],
    habits: [habit],
    addHabitEvents: events,
    preferences: { ...data.preferences, onboardingCompletedAt: now, updatedAt: now },
  });
  return { ok: true, goalId: goal.id, habitId: habit.id, status: habit.status };
}
