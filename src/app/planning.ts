import { isWithinBackfill } from '../domain/check-in';
import type { ChangeSet, LiveData } from '../data/repository';
import { applyHabitEdit } from '../domain/habit-edit';
import { transition, type StatusAction } from '../domain/habit-status';
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
import type { ReentryChoice } from '../domain/reentry';
import type { Goal, Habit, HabitEvent, HabitEventType, IsoTimestamp } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export type GoalErrors = FieldErrors<'title' | 'why' | 'successSignal'>;

/**
 * Zeitstempel für neue Ereignisse im Änderungsprotokoll: jetzt, aber immer nach dem letzten
 * gespeicherten Ereignis. So bleibt die Reihenfolge eindeutig, auch wenn zwei Aktionen in
 * dieselbe Millisekunde fallen oder die Geräteuhr zurückspringt.
 */
export function eventTime(ctx: AppContext, data: LiveData): IsoTimestamp {
  const now = ctx.clock.now().getTime();
  let latest = Number.NEGATIVE_INFINITY;
  for (const e of data.habitEvents) latest = Math.max(latest, Date.parse(e.at));
  return new Date(Math.max(now, latest + 1)).toISOString();
}

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
  const now = eventTime(ctx, data);
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

export type UpdateGoalResult = { ok: true } | { ok: false; errors: GoalErrors } | { ok: false; error: 'NOT_FOUND' };

/** Ändert Titel, Warum und Woran-ich-es-merke eines Ziels. */
export async function updateGoal(ctx: AppContext, goalId: string, input: GoalInput): Promise<UpdateGoalResult> {
  const norm = normalizeGoalInput(input);
  if (hasErrors(norm.errors)) return { ok: false, errors: norm.errors };
  const data = await ctx.repo.loadLive();
  const goal = data.goals.find((g) => g.id === goalId);
  if (!goal) return { ok: false, error: 'NOT_FOUND' };
  const { why: _w, successSignal: _s, ...rest } = goal;
  await ctx.repo.commit({ goals: [{ ...rest, ...norm.value, updatedAt: ctx.clock.now().toISOString() }] });
  return { ok: true };
}

export type UpdateHabitResult =
  | { ok: true; changed: boolean }
  | { ok: false; errors: FieldErrors<HabitField> }
  | { ok: false; error: 'NOT_FOUND' | 'ARCHIVED' };

/**
 * Bearbeitet ein Habit. Der vorherige Stand landet im Änderungsprotokoll; Rhythmus und Gewicht
 * gelten ab heute. Bestehende Angaben bleiben unverändert.
 */
export async function updateHabit(
  ctx: AppContext,
  habitId: string,
  input: Omit<HabitInput, 'kind' | 'goalId'>,
): Promise<UpdateHabitResult> {
  const data = await ctx.repo.loadLive();
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, error: 'NOT_FOUND' };
  if (habit.status === 'ARCHIVED') return { ok: false, error: 'ARCHIVED' };
  const norm = normalizeHabitInput({ ...input, kind: habit.kind, ...(habit.goalId ? { goalId: habit.goalId } : {}) });
  if (hasErrors(norm.errors)) return { ok: false, errors: norm.errors };
  const edit = applyHabitEdit(habit, norm.value, {
    day: today(ctx.clock),
    now: eventTime(ctx, data),
    newId: ctx.newId,
  });
  if (edit.events.length === 0) return { ok: true, changed: false };
  await ctx.repo.commit({ habits: [edit.habit], addHabitEvents: edit.events });
  return { ok: true, changed: true };
}

export type StatusChange = Exclude<StatusAction, 'ACTIVATE'>;
export type ChangeStatusResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'BUILD_LIMIT_REACHED' };

const STATUS_EVENT: Record<StatusChange, HabitEventType> = { PAUSE: 'PAUSED', RESUME: 'RESUMED', ARCHIVE: 'ARCHIVED' };

function statusChange(
  ctx: AppContext,
  habit: Habit,
  action: StatusChange,
  at: { day: LocalDate; now: IsoTimestamp; buildingCount: number; integrated: boolean },
): { habit: Habit; event: HabitEvent } | { reason: 'INVALID_TRANSITION' | 'BUILD_LIMIT_REACHED' } {
  const result = transition(habit, action, { buildingCount: at.buildingCount, integrated: at.integrated });
  if (!result.ok) return { reason: result.reason };
  return {
    habit: { ...habit, status: result.next, updatedAt: at.now },
    event: {
      id: ctx.newId(),
      habitId: habit.id,
      localDate: at.day,
      at: at.now,
      type: STATUS_EVENT[action],
      before: habit.status,
      after: result.next,
    },
  };
}

/**
 * Pausieren, Fortsetzen oder Archivieren. Fortsetzen braucht einen freien Platz im Aufbau,
 * außer das Habit ist bereits integriert. Archivieren ist endgültig.
 */
export async function changeHabitStatus(ctx: AppContext, habitId: string, action: StatusChange): Promise<ChangeStatusResult> {
  const data = await ctx.repo.loadLive();
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, reason: 'NOT_FOUND' };
  const day = today(ctx.clock);
  const derived = derive(data, day);
  const change = statusChange(ctx, habit, action, {
    day,
    now: eventTime(ctx, data),
    buildingCount: derived.buildingCount,
    integrated: derived.isIntegrated(habit),
  });
  if ('reason' in change) return { ok: false, reason: change.reason };
  await ctx.repo.commit({ habits: [change.habit], addHabitEvents: [change.event] });
  return { ok: true };
}

/** Alles, was beim Löschen von Habits mit entfernt wird: Ereignisse, Angaben, Rückblick-Einträge. */
function deletionOf(data: LiveData, habitIds: ReadonlySet<string>, deletedAt: IsoTimestamp): ChangeSet {
  const ids = [...habitIds];
  return {
    habits: ids.map((id) => ({ id, deletedAt })),
    removeHabitEventsOf: ids,
    checkIns: data.checkIns.filter((c) => habitIds.has(c.habitId)).map((c) => ({ id: c.id, deletedAt })),
    weeklyReviews: data.weeklyReviews
      .filter((r) => r.entries.some((e) => habitIds.has(e.habitId)))
      .map((r) => ({ ...r, entries: r.entries.filter((e) => !habitIds.has(e.habitId)), updatedAt: deletedAt })),
  };
}

/** Löscht ein Habit mit allen zugehörigen Daten in einer Transaktion. Nicht rückgängig zu machen. */
export async function deleteHabit(ctx: AppContext, habitId: string): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  if (!data.habits.some((h) => h.id === habitId)) return { ok: false };
  await ctx.repo.commit(deletionOf(data, new Set([habitId]), ctx.clock.now().toISOString()));
  return { ok: true };
}

/** Löscht ein Ziel samt seinen Habits (auch pausierten, archivierten und Entwürfen). */
export async function deleteGoal(ctx: AppContext, goalId: string): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  if (!data.goals.some((g) => g.id === goalId)) return { ok: false };
  const deletedAt = ctx.clock.now().toISOString();
  const habitIds = new Set(data.habits.filter((h) => h.goalId === goalId).map((h) => h.id));
  await ctx.repo.commit({ ...deletionOf(data, habitIds, deletedAt), goals: [{ id: goalId, deletedAt }] });
  return { ok: true };
}

export interface ReenterInput {
  /** Die betroffenen Habits laut Wiedereinstiegskarte */
  habitIds: string[];
  choice: ReentryChoice;
  /** Bei mehreren Habits: das Habit, auf das sich die Wahl bezieht */
  targetId?: string;
}

/**
 * Wiedereinstieg: schreibt für jedes betroffene Habit ein REENTERED-Ereignis; das gewählte Habit
 * trägt die Wahl, die übrigen „CONTINUE“. „Pausieren“ pausiert das gewählte Habit in derselben
 * Transaktion. „Kleiner machen“ und „Auslöser ändern“ führen danach ins Bearbeiten-Formular.
 */
export async function reenter(ctx: AppContext, input: ReenterInput): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  const habits = input.habitIds
    .map((id) => data.habits.find((h) => h.id === id))
    .filter((h): h is Habit => h !== undefined && h.status === 'ACTIVE');
  const target = habits.find((h) => h.id === (input.targetId ?? habits[0]?.id));
  if (!target) return { ok: false };
  const day = today(ctx.clock);
  const now = eventTime(ctx, data);
  const changes: ChangeSet = {
    addHabitEvents: habits.map((h) => ({
      id: ctx.newId(),
      habitId: h.id,
      localDate: day,
      at: now,
      type: 'REENTERED',
      after: h === target ? input.choice : 'CONTINUE',
    })),
  };
  if (input.choice === 'PAUSE') {
    const change = statusChange(ctx, target, 'PAUSE', { day, now, buildingCount: 0, integrated: false });
    if ('reason' in change) return { ok: false };
    changes.habits = [change.habit];
    changes.addHabitEvents!.push(change.event);
  }
  await ctx.repo.commit(changes);
  return { ok: true };
}
