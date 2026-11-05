import { addDays, type LocalDate } from '../src/domain/local-date';
import type { BuildOutcome, CheckIn, Habit, HabitEvent, HabitEventType } from '../src/domain/types';

export const NOW = '2026-01-01T08:00:00.000Z';

export function counterIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    kind: 'BUILD',
    actionText: '10 Minuten spazieren',
    minimumText: '2 Minuten vor die Tür',
    cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' },
    copingPlans: [],
    schedule: { type: 'DAILY' },
    weight: 1,
    status: 'ACTIVE',
    activatedOn: '2026-01-01',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let eventSeq = 0;
export function event(
  habitId: string,
  localDate: LocalDate,
  type: HabitEventType,
  before?: unknown,
  after?: unknown,
): HabitEvent {
  eventSeq++;
  return {
    id: `ev-${eventSeq}`,
    habitId,
    localDate,
    at: `${localDate}T10:00:${String(eventSeq % 60).padStart(2, '0')}.000Z`,
    type,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}

export function checkIn(habitId: string, localDate: LocalDate, outcome: BuildOutcome, minimal = false): CheckIn {
  return {
    id: `c-${habitId}-${localDate}`,
    habitId,
    localDate,
    outcome,
    minimal,
    unplanned: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Check-ins für `count` aufeinanderfolgende Tage ab `from`. */
export function checkInRun(
  habitId: string,
  from: LocalDate,
  count: number,
  outcome: BuildOutcome,
  minimal = false,
): CheckIn[] {
  return Array.from({ length: count }, (_, i) => checkIn(habitId, addDays(from, i), outcome, minimal));
}

export function byDay(checkIns: CheckIn[]): Map<LocalDate, CheckIn> {
  return new Map(checkIns.map((c) => [c.localDate, c]));
}
