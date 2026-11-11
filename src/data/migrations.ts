import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { DB_NAME, DB_VERSION, type LiveDB, type StoreName } from './schema';

/**
 * Eine Migration hebt das Schema von Version n−1 auf n. Sie läuft in der
 * Upgrade-Transaktion: Schlägt sie fehl, bricht IndexedDB das gesamte Upgrade ab
 * und die Datenbank bleibt auf der alten Version.
 */
export type Migration = (
  db: IDBPDatabase<unknown>,
  tx: IDBPTransaction<unknown, string[], 'versionchange'>,
) => void | Promise<void>;

export const migrations: Record<number, Migration> = {
  1: (db) => {
    db.createObjectStore('preferences', { keyPath: 'id' });
    db.createObjectStore('goals', { keyPath: 'id' });
    const habits = db.createObjectStore('habits', { keyPath: 'id' });
    habits.createIndex('goalId', 'goalId');
    const events = db.createObjectStore('habitEvents', { keyPath: 'id' });
    events.createIndex('habitId', 'habitId');
    const checkIns = db.createObjectStore('checkIns', { keyPath: 'id' });
    checkIns.createIndex('habitId', 'habitId');
    checkIns.createIndex('localDate', 'localDate');
    // Löschmarkierungen haben weder habitId noch localDate und fallen damit aus dem Index.
    checkIns.createIndex('habitId_localDate', ['habitId', 'localDate'], { unique: true });
    db.createObjectStore('dayRecords', { keyPath: 'localDate' });
    db.createObjectStore('avoidanceItems', { keyPath: 'id' });
    const reviews = db.createObjectStore('weeklyReviews', { keyPath: 'id' });
    reviews.createIndex('weekStart', 'weekStart', { unique: true });
    db.createObjectStore('meta', { keyPath: 'key' });
  },
  // Vorhaben: einmalige Aufgaben mit Deadline.
  2: (db) => {
    db.createObjectStore('tasks', { keyPath: 'id' });
  },
};

export interface OpenOptions {
  name?: string;
  version?: number;
  migrations?: Record<number, Migration>;
  /** Wird aufgerufen, wenn ein anderer Tab eine neuere Version öffnen will. */
  onVersionChange?: () => void;
  /** Wird aufgerufen, wenn der Browser die Verbindung unerwartet schließt (z. B. Browserdaten gelöscht). */
  onTerminated?: () => void;
}

export async function openDatabase(options: OpenOptions = {}): Promise<IDBPDatabase<LiveDB>> {
  const name = options.name ?? DB_NAME;
  const version = options.version ?? DB_VERSION;
  const steps = options.migrations ?? migrations;
  for (let v = 1; v <= version; v++) {
    if (!steps[v]) throw new Error(`Migration ${v} fehlt.`);
  }
  // idb wartet nicht auf ein async `upgrade`. Ein Fehler darin muss die Upgrade-Transaktion
  // daher ausdrücklich abbrechen, sonst würde die neue Version trotzdem festgeschrieben.
  let upgradeError: unknown;
  let db: IDBPDatabase<LiveDB>;
  try {
    db = await openDB<LiveDB>(name, version, {
      async upgrade(database, oldVersion, newVersion, tx) {
        try {
          const target = newVersion ?? version;
          for (let v = oldVersion + 1; v <= target; v++) {
            await steps[v]!(
              database as unknown as IDBPDatabase<unknown>,
              tx as unknown as IDBPTransaction<unknown, string[], 'versionchange'>,
            );
          }
          if ((database.objectStoreNames as DOMStringList).contains('meta')) {
            await tx.objectStore('meta' as StoreName as 'meta').put({ key: 'dbVersion', value: target });
          }
        } catch (error) {
          upgradeError = error;
          tx.done.catch(() => undefined);
          try {
            tx.abort();
          } catch {
            // bereits abgebrochen
          }
        }
      },
      blocking() {
        // Ein anderer Tab braucht eine neuere Version: Verbindung freigeben.
        db.close();
        options.onVersionChange?.();
      },
      terminated() {
        options.onTerminated?.();
      },
    });
  } catch (error) {
    throw upgradeError ?? error;
  }
  return db;
}
