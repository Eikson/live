import type { Snapshot } from './snapshot';
import {
  isTombstone,
  type CheckIn,
  type DayRecord,
  type Habit,
  type Preferences,
  type Stored,
  type Tombstone,
  type WeeklyReview,
} from './types';

/**
 * Zusammenführen zweier Bestände (Abschnitt 7). Rein und deterministisch, damit dieselbe
 * Logik später auch für einen Abgleich über einen eigenen Server taugt.
 *
 * Regeln (docs/entscheidungen.md):
 * - Je Datensatz-ID gewinnt der neuere Stand (`updatedAt` bzw. `deletedAt` einer Löschmarkierung).
 * - Gleich alt: eine Löschmarkierung gewinnt gegen einen lebenden Eintrag, sonst bleibt der lokale.
 * - Check-ins werden zusätzlich über [habitId, localDate] abgeglichen, `dayRecords` über localDate,
 *   Wochenrückblicke über die Woche. `habitEvents` werden vereinigt.
 * - Danach bleibt nichts verwaist: Habits gelöschter Ziele, Check-ins und Ereignisse gelöschter
 *   Habits werden ebenfalls entfernt.
 */
export function mergeSnapshots(local: Snapshot, incoming: Snapshot): Snapshot {
  const goals = mergeById(local.goals, incoming.goals);
  const goalById = new Map(goals.map((g) => [g.id, g]));

  // Habits gelöschter Ziele werden mitgelöscht (wie beim Löschen eines Ziels in der App).
  const habits = mergeById(local.habits, incoming.habits).map((h): Stored<Habit> => {
    if (isTombstone(h) || h.goalId === undefined) return h;
    const owner = goalById.get(h.goalId);
    if (owner && !isTombstone(owner)) return h;
    return { id: h.id, deletedAt: owner ? later(owner.deletedAt, h.updatedAt) : h.updatedAt };
  });
  const habitById = new Map(habits.map((h) => [h.id, h]));
  const living = (habitId: string) => {
    const h = habitById.get(habitId);
    return h !== undefined && !isTombstone(h);
  };

  return {
    preferences: mergePreferences(local.preferences, incoming.preferences),
    goals,
    habits,
    habitEvents: unionEvents(local, incoming).filter((e) => living(e.habitId)),
    checkIns: mergeCheckIns(local.checkIns, incoming.checkIns, habitById),
    dayRecords: mergeDayRecords(local.dayRecords, incoming.dayRecords),
    avoidanceItems: mergeById(local.avoidanceItems, incoming.avoidanceItems),
    weeklyReviews: mergeReviews(local.weeklyReviews, incoming.weeklyReviews).map((r) => ({
      ...r,
      entries: r.entries.filter((e) => living(e.habitId)),
    })),
  };
}

const time = (iso: string) => Date.parse(iso);
const later = (a: string, b: string) => (time(b) > time(a) ? b : a);
const stamp = (r: Stored<{ id: string; updatedAt: string }>) => (isTombstone(r) ? r.deletedAt : r.updatedAt);

/** Neuerer Stand gewinnt; gleich alt: Löschmarkierung vor lebend, sonst lokal. */
function pick<T extends { id: string; updatedAt: string }>(local: Stored<T>, incoming: Stored<T>): Stored<T> {
  const a = time(stamp(local));
  const b = time(stamp(incoming));
  if (b > a) return incoming;
  if (b < a) return local;
  return isTombstone(incoming) && !isTombstone(local) ? incoming : local;
}

function mergeById<T extends { id: string; updatedAt: string }>(local: Stored<T>[], incoming: Stored<T>[]): Stored<T>[] {
  const result = new Map<string, Stored<T>>();
  for (const r of local) result.set(r.id, r);
  for (const r of incoming) {
    const existing = result.get(r.id);
    result.set(r.id, existing ? pick(existing, r) : r);
  }
  return [...result.values()];
}

function mergeCheckIns(
  local: Stored<CheckIn>[],
  incoming: Stored<CheckIn>[],
  habitById: Map<string, Stored<Habit>>,
): Stored<CheckIn>[] {
  const localIds = new Set(local.map((c) => c.id));
  const merged = mergeById(local, incoming);

  // Je [habitId, localDate] höchstens ein lebender Check-in: der neueste, bei Gleichstand der lokale.
  const winners = new Map<string, CheckIn>();
  for (const c of merged) {
    if (isTombstone(c)) continue;
    const key = `${c.habitId}|${c.localDate}`;
    const current = winners.get(key);
    if (!current || beats(c, current, localIds)) winners.set(key, c);
  }

  return merged.map((c): Stored<CheckIn> => {
    if (isTombstone(c)) return c;
    const owner = habitById.get(c.habitId);
    if (!owner || isTombstone(owner)) {
      return { id: c.id, deletedAt: owner ? later(owner.deletedAt, c.updatedAt) : c.updatedAt };
    }
    const winner = winners.get(`${c.habitId}|${c.localDate}`)!;
    return winner.id === c.id ? c : ({ id: c.id, deletedAt: later(winner.updatedAt, c.updatedAt) } satisfies Tombstone);
  });
}

function beats(candidate: CheckIn, current: CheckIn, localIds: Set<string>): boolean {
  const a = time(candidate.updatedAt);
  const b = time(current.updatedAt);
  if (a !== b) return a > b;
  return localIds.has(candidate.id) && !localIds.has(current.id);
}

function mergeDayRecords(local: DayRecord[], incoming: DayRecord[]): DayRecord[] {
  const result = new Map<string, DayRecord>();
  for (const d of local) result.set(d.localDate, d);
  for (const d of incoming) {
    const existing = result.get(d.localDate);
    if (!existing || time(d.updatedAt) > time(existing.updatedAt)) result.set(d.localDate, d);
  }
  return [...result.values()];
}

function unionEvents(local: Snapshot, incoming: Snapshot) {
  const result = new Map(local.habitEvents.map((e) => [e.id, e]));
  for (const e of incoming.habitEvents) if (!result.has(e.id)) result.set(e.id, e);
  return [...result.values()];
}

/** Je ID der neuere Stand, danach je Woche höchstens ein Rückblick (der neuere, bei Gleichstand der lokale). */
function mergeReviews(local: WeeklyReview[], incoming: WeeklyReview[]): WeeklyReview[] {
  const byId = new Map<string, WeeklyReview>();
  const localIds = new Set(local.map((r) => r.id));
  for (const r of local) byId.set(r.id, r);
  for (const r of incoming) {
    const existing = byId.get(r.id);
    if (!existing || time(r.updatedAt) > time(existing.updatedAt)) byId.set(r.id, r);
  }
  const byWeek = new Map<string, WeeklyReview>();
  for (const r of byId.values()) {
    const current = byWeek.get(r.weekStart);
    if (!current) {
      byWeek.set(r.weekStart, r);
      continue;
    }
    const a = time(r.updatedAt);
    const b = time(current.updatedAt);
    if (a > b || (a === b && localIds.has(r.id) && !localIds.has(current.id))) byWeek.set(r.weekStart, r);
  }
  return [...byWeek.values()];
}

/**
 * Einstellungen: der neuere Stand gewinnt. Erster Start bleibt der früheste,
 * das letzte Backup der späteste bekannte Zeitpunkt.
 */
function mergePreferences(local: Preferences, incoming: Preferences): Preferences {
  const base = time(incoming.updatedAt) > time(local.updatedAt) ? incoming : local;
  const onboarding = earliest(local.onboardingCompletedAt, incoming.onboardingCompletedAt);
  const backup = latest(local.lastBackupAt, incoming.lastBackupAt);
  const { onboardingCompletedAt: _o, lastBackupAt: _b, ...rest } = base;
  return {
    ...rest,
    ...(onboarding ? { onboardingCompletedAt: onboarding } : {}),
    ...(backup ? { lastBackupAt: backup } : {}),
  };
}

function earliest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return time(b) < time(a) ? b : a;
}

function latest(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return later(a, b);
}
