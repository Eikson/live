import { isWithinBackfill } from '../domain/check-in';
import { transition } from '../domain/habit-status';
import type { LocalDate } from '../domain/local-date';
import {
  hasErrors,
  normalizeGoalInput,
  normalizeHabitInput,
  type FieldErrors,
  type GoalInput,
  type HabitField,
  type HabitInput,
  type NormalizedHabitInput,
} from '../domain/planning';
import type { Goal, Habit, HabitEvent, IsoTimestamp } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export type GoalErrors = FieldErrors<'title' | 'why' | 'successSignal'>;

/** Neues Ziel aus geprüften Angaben. */
export function newGoal(ctx: AppContext, value: ReturnType<typeof normalizeGoalInput>['value'], now: IsoTimestamp): Goal {
  return { id: ctx.newId(), ...value, status: 'ACTIVE', createdAt: now, updatedAt: now };
}

/**
 * Legt ein Habit als Entwurf an und aktiviert es sofort, wenn ein Platz im Aufbau frei ist.
 * Liefert Habit und Ereignisse; geschrieben wird vom Aufrufer in einer Transaktion.
 */
export function newHabit(
  ctx: AppContext,
  value: NormalizedHabitInput,
  at: { day: LocalDate; now: IsoTimestamp; buildingCount: number },
): { habit: Habit; events: HabitEvent[] } {
  const { day, now } = at;
  const draft: Habit = { id: ctx.newId(), ...value, status: 'DRAFT', createdAt: now, updatedAt: now };
  const events: HabitEvent[] = [
    { id: ctx.newId(), habitId: draft.id, localDate: day, at: now, type: 'CREATED', after: 'DRAFT' },
  ];
  const activation = transition(draft, 'ACTIVATE', { buildingCount: at.buildingCount });
  if (!activation.ok) return { habit: draft, events };
  events.push({ id: ctx.newId(), habitId: draft.id, localDate: day, at: now, type: 'ACTIVATED', before: 'DRAFT', after: 'ACTIVE' });
  return { habit: { ...draft, status: activation.next, activatedOn: day }, events };
}

export type CreateGoalResult = { ok: true; goalId: string } | { ok: false; errors: GoalErrors };

export async function createGoal(ctx: AppContext, input: GoalInput): Promise<CreateGoalResult> {
  const norm = normalizeGoalInput(input);
  if (hasErrors(norm.errors)) return { ok: false, errors: norm.errors };
  const goal = newGoal(ctx, norm.value, ctx.clock.now().toISOString());
  await ctx.repo.commit({ goals: [goal] });
  return { ok: true, goalId: goal.id };
}

export interface CreateHabitInput {
  goalId: string;
  habit: Omit<HabitInput, 'kind' | 'goalId'>;
}

export type CreateHabitResult =
  | { ok: true; habitId: string; status: Habit['status'] }
  | { ok: false; errors: FieldErrors<HabitField> }
  | { ok: false; error: 'GOAL_NOT_FOUND' };

/** Neues Habit zu einem bestehenden Ziel. Ist die Aufbau-Grenze erreicht, bleibt es ein Entwurf. */
export async function createHabit(ctx: AppContext, input: CreateHabitInput): Promise<CreateHabitResult> {
  const norm = normalizeHabitInput({ ...input.habit, kind: 'BUILD', goalId: input.goalId });
  if (hasErrors(norm.errors)) return { ok: false, errors: norm.errors };
  const data = await ctx.repo.loadLive();
  if (!data.goals.some((g) => g.id === input.goalId && g.status === 'ACTIVE')) return { ok: false, error: 'GOAL_NOT_FOUND' };
  const day = today(ctx.clock);
  const { habit, events } = newHabit(ctx, norm.value, {
    day,
    now: ctx.clock.now().toISOString(),
    buildingCount: derive(data, day).buildingCount,
  });
  await ctx.repo.commit({ habits: [habit], addHabitEvents: events });
  return { ok: true, habitId: habit.id, status: habit.status };
}

export type ActivateResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'BUILD_LIMIT_REACHED' };

/** Aktiviert einen Entwurf, sofern ein Platz im Aufbau frei ist. */
export async function activateHabit(ctx: AppContext, habitId: string): Promise<ActivateResult> {
  const data = await ctx.repo.loadLive();
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, reason: 'NOT_FOUND' };
  const day = today(ctx.clock);
  const result = transition(habit, 'ACTIVATE', { buildingCount: derive(data, day).buildingCount });
  if (!result.ok) return { ok: false, reason: result.reason };
  const now = ctx.clock.now().toISOString();
  await ctx.repo.commit({
    habits: [{ ...habit, status: result.next, activatedOn: day, updatedAt: now }],
    addHabitEvents: [
      { id: ctx.newId(), habitId, localDate: day, at: now, type: 'ACTIVATED', before: habit.status, after: result.next },
    ],
  });
  return { ok: true };
}

export type RemoveCheckInResult = { ok: true } | { ok: false; error: 'OUT_OF_RANGE' };

/**
 * Nimmt eine Angabe zurück (z. B. ein versehentliches „Trotzdem gemacht“). Es bleibt nur
 * eine Löschmarkierung; danach ist für diesen Tag wieder ein neuer Eintrag möglich.
 */
export async function removeCheckIn(
  ctx: AppContext,
  input: { habitId: string; localDate: LocalDate },
): Promise<RemoveCheckInResult> {
  if (!isWithinBackfill(input.localDate, today(ctx.clock))) return { ok: false, error: 'OUT_OF_RANGE' };
  const deletedAt = ctx.clock.now().toISOString();
  await ctx.repo.upsertCheckIn(input.habitId, input.localDate, (existing) =>
    existing ? { id: existing.id, deletedAt } : null,
  );
  return { ok: true };
}
