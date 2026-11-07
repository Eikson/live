import { normalizeAvoidanceLabel, nextAvoidanceOrder, sortAvoidanceItems, type AvoidanceLabelError } from '../domain/avoidance';
import { isPredefinedCounterKind, PREDEFINED_COUNTER_TEXT, type PredefinedCounterKind } from '../domain/evening';
import { hasErrors, normalizeHabitInput, type FieldErrors, type HabitField } from '../domain/planning';
import type { AvoidanceItem, Habit, HabitKind } from '../domain/types';
import type { LiveData } from '../data/repository';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';
import { eventTime, newHabit } from './planning';

export type CounterKind = Exclude<HabitKind, 'BUILD'>;

/** Vordefinierte Gegen-Habits gibt es höchstens einmal (archivierte zählen nicht). */
export function existingPredefined(data: Pick<LiveData, 'habits'>, kind: PredefinedCounterKind): Habit | undefined {
  return data.habits.find((h) => h.kind === kind && h.status !== 'ARCHIVED');
}

/** Welche vordefinierten Gegen-Habits sich noch anlegen lassen. */
export function availablePredefined(data: Pick<LiveData, 'habits'>): PredefinedCounterKind[] {
  return (['COUNTER_PROCRASTINATION', 'COUNTER_AVOIDANCE'] as const).filter((k) => !existingPredefined(data, k));
}

export interface CreateCounterInput {
  kind: CounterKind;
  /** Nur bei eigenen Gegen-Habits; vordefinierte haben einen festen Text. */
  actionText?: string;
  weight?: number;
}

export type CreateCounterResult =
  | { ok: true; habitId: string }
  | { ok: false; errors: FieldErrors<HabitField> }
  | { ok: false; error: 'EXISTS' };

/** Baut neue Gegen-Habits samt Ereignissen; sie sind sofort aktiv und zählen nicht zur Aufbau-Grenze. */
export function newCounterHabits(
  ctx: AppContext,
  data: LiveData,
  inputs: readonly CreateCounterInput[],
): { habits: Habit[]; events: ReturnType<typeof newHabit>['events'] } | { errors: FieldErrors<HabitField> } | 'EXISTS' {
  const day = today(ctx.clock);
  const now = eventTime(ctx, data);
  const habits: Habit[] = [];
  const events: ReturnType<typeof newHabit>['events'] = [];
  for (const input of inputs) {
    const predefined = isPredefinedCounterKind(input.kind);
    if (predefined && (existingPredefined(data, input.kind as PredefinedCounterKind) || habits.some((h) => h.kind === input.kind))) {
      return 'EXISTS';
    }
    const actionText = predefined ? PREDEFINED_COUNTER_TEXT[input.kind as PredefinedCounterKind] : (input.actionText ?? '');
    const norm = normalizeHabitInput({
      kind: input.kind,
      actionText,
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
    });
    if (hasErrors(norm.errors)) return { errors: norm.errors };
    const created = newHabit(ctx, norm.value, { day, now, buildingCount: derive(data, day).buildingCount });
    habits.push(created.habit);
    events.push(...created.events);
  }
  return { habits, events };
}

export async function createCounterHabit(ctx: AppContext, input: CreateCounterInput): Promise<CreateCounterResult> {
  const data = await ctx.repo.loadLive();
  const result = newCounterHabits(ctx, data, [input]);
  if (result === 'EXISTS') return { ok: false, error: 'EXISTS' };
  if ('errors' in result) return { ok: false, errors: result.errors };
  await ctx.repo.commit({ habits: result.habits, addHabitEvents: result.events });
  return { ok: true, habitId: result.habits[0]!.id };
}

/** Die Ausweichliste in ihrer Reihenfolge, aktive und ausgeblendete getrennt. */
export async function loadAvoidanceList(ctx: AppContext): Promise<{ active: AvoidanceItem[]; hidden: AvoidanceItem[] }> {
  const items = sortAvoidanceItems((await ctx.repo.loadLive()).avoidanceItems);
  return { active: items.filter((i) => i.active), hidden: items.filter((i) => !i.active) };
}

export type AvoidanceResult = { ok: true; id: string } | { ok: false; error: AvoidanceLabelError | 'NOT_FOUND' };

/** Ergänzt die persönliche Ausweichliste. Es gibt keine vorgegebenen Einträge. */
export async function addAvoidanceItem(ctx: AppContext, label: string): Promise<AvoidanceResult> {
  const data = await ctx.repo.loadLive();
  const norm = normalizeAvoidanceLabel(label, data.avoidanceItems);
  if (!norm.ok) return norm;
  const now = ctx.clock.now().toISOString();
  const item: AvoidanceItem = {
    id: ctx.newId(),
    label: norm.label,
    active: true,
    order: nextAvoidanceOrder(data.avoidanceItems),
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repo.commit({ avoidanceItems: [item] });
  return { ok: true, id: item.id };
}

export async function renameAvoidanceItem(ctx: AppContext, id: string, label: string): Promise<AvoidanceResult> {
  const data = await ctx.repo.loadLive();
  const item = data.avoidanceItems.find((i) => i.id === id);
  if (!item) return { ok: false, error: 'NOT_FOUND' };
  const norm = normalizeAvoidanceLabel(label, data.avoidanceItems, id);
  if (!norm.ok) return norm;
  await ctx.repo.commit({ avoidanceItems: [{ ...item, label: norm.label, updatedAt: ctx.clock.now().toISOString() }] });
  return { ok: true, id };
}

/** Ausgeblendete Einträge erscheinen nicht mehr im Abend-Check-in; frühere Angaben bleiben. */
export async function setAvoidanceItemActive(ctx: AppContext, id: string, active: boolean): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  const item = data.avoidanceItems.find((i) => i.id === id);
  if (!item) return { ok: false };
  await ctx.repo.commit({ avoidanceItems: [{ ...item, active, updatedAt: ctx.clock.now().toISOString() }] });
  return { ok: true };
}

/**
 * Verschiebt einen Eintrag um eine Position nach oben (-1) oder unten (+1), innerhalb der
 * aktiven bzw. der ausgeblendeten Einträge.
 */
export async function moveAvoidanceItem(ctx: AppContext, id: string, direction: -1 | 1): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  const sorted = sortAvoidanceItems(data.avoidanceItems);
  const item = sorted.find((i) => i.id === id);
  if (!item) return { ok: false };
  const peers = sorted.filter((i) => i.active === item.active);
  const other = peers[peers.indexOf(item) + direction];
  if (!other) return { ok: false };
  const now = ctx.clock.now().toISOString();
  // Reihenfolge neu durchnummerieren, damit gleiche Werte keine Rolle spielen.
  const reordered = sorted.map((i) => (i === item ? other : i === other ? item : i));
  await ctx.repo.commit({
    avoidanceItems: reordered
      .map((i, order) => ({ i, order }))
      .filter(({ i, order }) => i.order !== order)
      .map(({ i, order }) => ({ ...i, order, updatedAt: now })),
  });
  return { ok: true };
}

/**
 * Entfernt einen Eintrag endgültig. Frühere Angaben behalten die ID, zeigen den Text aber nicht mehr an;
 * am Ergebnis des Tages („mindestens eins abgehakt“) ändert das nichts.
 */
export async function deleteAvoidanceItem(ctx: AppContext, id: string): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  if (!data.avoidanceItems.some((i) => i.id === id)) return { ok: false };
  await ctx.repo.commit({ avoidanceItems: [{ id, deletedAt: ctx.clock.now().toISOString() }] });
  return { ok: true };
}
