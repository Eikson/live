import type { LocalDate } from './local-date';
import type { NormalizedHabitInput } from './planning';
import type { Habit, HabitEvent, IsoTimestamp } from './types';

/** Felder, deren Änderung als EDITED protokolliert wird. Rhythmus und Gewicht haben eigene Ereignisse. */
const EDITED_FIELDS = ['actionText', 'minimumText', 'cue', 'intention', 'copingPlans'] as const;
type EditedField = (typeof EDITED_FIELDS)[number];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Vergleicht ein Habit mit neuen, geprüften Angaben. Liefert das geänderte Habit und die
 * Ereignisse fürs Änderungsprotokoll mit dem vorherigen Stand. Ohne Änderung: keine Ereignisse.
 * Rhythmus und Gewicht gelten ab `day`; frühere Tage behalten ihre damaligen Werte.
 */
export function applyHabitEdit(
  habit: Habit,
  value: NormalizedHabitInput,
  at: { day: LocalDate; now: IsoTimestamp; newId: () => string },
): { habit: Habit; events: HabitEvent[] } {
  const base = { habitId: habit.id, localDate: at.day, at: at.now };
  const events: HabitEvent[] = [];

  const before: Partial<Record<EditedField, unknown>> = {};
  const after: Partial<Record<EditedField, unknown>> = {};
  for (const field of EDITED_FIELDS) {
    if (!same(habit[field], value[field])) {
      before[field] = habit[field] ?? null;
      after[field] = value[field] ?? null;
    }
  }
  if (Object.keys(after).length > 0) events.push({ id: at.newId(), ...base, type: 'EDITED', before, after });
  if (!same(habit.schedule, value.schedule)) {
    events.push({ id: at.newId(), ...base, type: 'SCHEDULE_CHANGED', before: habit.schedule, after: value.schedule });
  }
  if (habit.weight !== value.weight) {
    events.push({ id: at.newId(), ...base, type: 'WEIGHT_CHANGED', before: habit.weight, after: value.weight });
  }
  if (events.length === 0) return { habit, events };

  const { minimumText: _m, cue: _c, intention: _i, ...rest } = habit;
  const next: Habit = {
    ...rest,
    actionText: value.actionText,
    copingPlans: value.copingPlans,
    schedule: value.schedule,
    weight: value.weight,
    updatedAt: at.now,
  };
  if (value.minimumText) next.minimumText = value.minimumText;
  if (value.cue) next.cue = value.cue;
  if (value.intention) next.intention = value.intention;
  return { habit: next, events };
}
