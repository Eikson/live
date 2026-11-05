import {
  hasErrors,
  normalizeGoalInput,
  normalizeHabitInput,
  type FieldErrors,
  type GoalInput,
  type HabitField,
  type HabitInput,
} from '../domain/planning';
import type { Habit } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';
import { newGoal, newHabit, type GoalErrors } from './planning';

export interface OnboardingInput {
  goal: GoalInput;
  habit: Omit<HabitInput, 'kind' | 'goalId'>;
}

export type OnboardingResult =
  | { ok: true; goalId: string; habitId: string; status: Habit['status'] }
  | { ok: false; goalErrors: GoalErrors; habitErrors: FieldErrors<HabitField> };

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

  const goal = newGoal(ctx, goalNorm.value, now);
  const { habit, events } = newHabit(
    ctx,
    { ...habitNorm.value, goalId: goal.id },
    { day, now, buildingCount: derive(data, day).buildingCount },
  );

  await ctx.repo.commit({
    goals: [goal],
    habits: [habit],
    addHabitEvents: events,
    preferences: { ...data.preferences, onboardingCompletedAt: now, updatedAt: now },
  });
  return { ok: true, goalId: goal.id, habitId: habit.id, status: habit.status };
}
