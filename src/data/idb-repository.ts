import { deleteDB, type IDBPDatabase } from 'idb';
import type { LocalDate } from '../domain/local-date';
import { withPreferenceDefaults } from '../domain/preferences';
import { isTombstone, type CheckIn, type Stored } from '../domain/types';
import { openDatabase, type OpenOptions } from './migrations';
import type { ChangeSet, LiveData, LiveRepository, Snapshot } from './repository';
import { ALL_STORES, DB_NAME, type LiveDB, type StoreName } from './schema';

const live = <T extends { id: string }>(records: Stored<T>[]): T[] =>
  records.filter((r): r is T => !isTombstone(r));

function storesOf(changes: ChangeSet): StoreName[] {
  const stores = new Set<StoreName>();
  if (changes.preferences) stores.add('preferences');
  if (changes.goals?.length) stores.add('goals');
  if (changes.habits?.length) stores.add('habits');
  if (changes.addHabitEvents?.length || changes.removeHabitEventsOf?.length) stores.add('habitEvents');
  if (changes.checkIns?.length) stores.add('checkIns');
  if (changes.dayRecords?.length || changes.removeDayRecords?.length) stores.add('dayRecords');
  if (changes.avoidanceItems?.length) stores.add('avoidanceItems');
  if (changes.weeklyReviews?.length || changes.removeWeeklyReviews?.length) stores.add('weeklyReviews');
  return [...stores];
}

export class IdbRepository implements LiveRepository {
  private constructor(
    private db: IDBPDatabase<LiveDB>,
    private readonly name: string,
    private readonly now: () => Date,
  ) {}

  static async open(options: OpenOptions & { now?: () => Date } = {}): Promise<IdbRepository> {
    const db = await openDatabase(options);
    return new IdbRepository(db, options.name ?? DB_NAME, options.now ?? (() => new Date()));
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  async getPreferences() {
    return withPreferenceDefaults(await this.db.get('preferences', 'preferences'), this.nowIso());
  }

  async loadSnapshot(): Promise<Snapshot> {
    const tx = this.db.transaction(ALL_STORES, 'readonly');
    const [preferences, goals, habits, habitEvents, checkIns, dayRecords, avoidanceItems, weeklyReviews] =
      await Promise.all([
        tx.objectStore('preferences').get('preferences'),
        tx.objectStore('goals').getAll(),
        tx.objectStore('habits').getAll(),
        tx.objectStore('habitEvents').getAll(),
        tx.objectStore('checkIns').getAll(),
        tx.objectStore('dayRecords').getAll(),
        tx.objectStore('avoidanceItems').getAll(),
        tx.objectStore('weeklyReviews').getAll(),
      ]);
    await tx.done;
    return {
      preferences: withPreferenceDefaults(preferences, this.nowIso()),
      goals,
      habits,
      habitEvents,
      checkIns,
      dayRecords,
      avoidanceItems,
      weeklyReviews,
    };
  }

  async loadLive(): Promise<LiveData> {
    const s = await this.loadSnapshot();
    return {
      ...s,
      goals: live(s.goals),
      habits: live(s.habits),
      checkIns: live(s.checkIns),
      avoidanceItems: live(s.avoidanceItems),
    };
  }

  async getHabit(id: string) {
    const h = await this.db.get('habits', id);
    return h && !isTombstone(h) ? h : undefined;
  }

  async getCheckIn(habitId: string, localDate: LocalDate) {
    const c = await this.db.getFromIndex('checkIns', 'habitId_localDate', [habitId, localDate]);
    return c && !isTombstone(c) ? c : undefined;
  }

  async commit(changes: ChangeSet): Promise<void> {
    const stores = storesOf(changes);
    if (stores.length === 0) return;
    const tx = this.db.transaction(stores, 'readwrite');
    const ops: Promise<unknown>[] = [];
    if (changes.preferences) ops.push(tx.objectStore('preferences').put(changes.preferences));
    for (const g of changes.goals ?? []) ops.push(tx.objectStore('goals').put(g));
    for (const h of changes.habits ?? []) ops.push(tx.objectStore('habits').put(h));
    for (const e of changes.addHabitEvents ?? []) ops.push(tx.objectStore('habitEvents').add(e));
    for (const habitId of changes.removeHabitEventsOf ?? []) {
      const store = tx.objectStore('habitEvents');
      ops.push(
        store.index('habitId').getAllKeys(habitId).then((keys) => Promise.all(keys.map((k) => store.delete(k)))),
      );
    }
    for (const c of changes.checkIns ?? []) ops.push(tx.objectStore('checkIns').put(c));
    for (const d of changes.dayRecords ?? []) ops.push(tx.objectStore('dayRecords').put(d));
    for (const d of changes.removeDayRecords ?? []) ops.push(tx.objectStore('dayRecords').delete(d));
    for (const a of changes.avoidanceItems ?? []) ops.push(tx.objectStore('avoidanceItems').put(a));
    for (const r of changes.weeklyReviews ?? []) ops.push(tx.objectStore('weeklyReviews').put(r));
    for (const id of changes.removeWeeklyReviews ?? []) ops.push(tx.objectStore('weeklyReviews').delete(id));
    await runAtomically(tx, ops);
  }

  async upsertCheckIn(
    habitId: string,
    localDate: LocalDate,
    update: (existing: CheckIn | undefined) => Stored<CheckIn> | null,
  ) {
    const tx = this.db.transaction('checkIns', 'readwrite');
    const store = tx.objectStore('checkIns');
    let result: Stored<CheckIn> | null = null;
    const op = store
      .index('habitId_localDate')
      .get([habitId, localDate])
      .then(async (found) => {
        const existing = found && !isTombstone(found) ? found : undefined;
        result = update(existing);
        if (result) await store.put(result);
      });
    await runAtomically(tx, [op]);
    return result;
  }

  async replaceAll(snapshot: Snapshot): Promise<void> {
    const stores = ALL_STORES.filter((s) => s !== 'meta');
    const tx = this.db.transaction(stores, 'readwrite');
    const ops: Promise<unknown>[] = stores.map((s) => tx.objectStore(s).clear());
    ops.push(tx.objectStore('preferences').put(snapshot.preferences));
    for (const g of snapshot.goals) ops.push(tx.objectStore('goals').put(g));
    for (const h of snapshot.habits) ops.push(tx.objectStore('habits').put(h));
    for (const e of snapshot.habitEvents) ops.push(tx.objectStore('habitEvents').put(e));
    for (const c of snapshot.checkIns) ops.push(tx.objectStore('checkIns').put(c));
    for (const d of snapshot.dayRecords) ops.push(tx.objectStore('dayRecords').put(d));
    for (const a of snapshot.avoidanceItems) ops.push(tx.objectStore('avoidanceItems').put(a));
    for (const r of snapshot.weeklyReviews) ops.push(tx.objectStore('weeklyReviews').put(r));
    await runAtomically(tx, ops);
  }

  async destroy(): Promise<void> {
    this.db.close();
    await deleteDB(this.name);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Wartet auf alle Operationen und den Abschluss der Transaktion. Schlägt eine Operation fehl,
 * wird die Transaktion explizit abgebrochen, damit keine Teilbestände entstehen.
 */
async function runAtomically(
  tx: { done: Promise<void>; abort(): void },
  ops: Promise<unknown>[],
): Promise<void> {
  try {
    await Promise.all(ops);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // bereits abgebrochen
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
  await tx.done;
}
