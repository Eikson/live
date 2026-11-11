import type { LocalDate } from '../domain/local-date';
import type { Snapshot } from '../domain/snapshot';
import type {
  AvoidanceItem,
  CheckIn,
  DayRecord,
  Goal,
  Habit,
  HabitEvent,
  Preferences,
  Stored,
  Task,
  WeeklyReview,
} from '../domain/types';

export type { Snapshot };

/** Lebende Datensätze ohne Löschmarkierungen – die Sicht der Oberfläche. */
export interface LiveData {
  preferences: Preferences;
  goals: Goal[];
  habits: Habit[];
  habitEvents: HabitEvent[];
  checkIns: CheckIn[];
  dayRecords: DayRecord[];
  avoidanceItems: AvoidanceItem[];
  weeklyReviews: WeeklyReview[];
  tasks: Task[];
}

/**
 * Eine Menge von Schreibvorgängen, die in **einer** Transaktion ausgeführt wird:
 * entweder alles oder nichts.
 */
export interface ChangeSet {
  preferences?: Preferences;
  goals?: Stored<Goal>[];
  habits?: Stored<Habit>[];
  /** Ereignisse werden nur ergänzt. */
  addHabitEvents?: HabitEvent[];
  /** Nur beim Löschen eines Habits: abhängige Ereignisse entfernen. */
  removeHabitEventsOf?: string[];
  checkIns?: Stored<CheckIn>[];
  dayRecords?: DayRecord[];
  removeDayRecords?: LocalDate[];
  avoidanceItems?: Stored<AvoidanceItem>[];
  weeklyReviews?: WeeklyReview[];
  removeWeeklyReviews?: string[];
  tasks?: Stored<Task>[];
}

export interface LiveRepository {
  getPreferences(): Promise<Preferences>;
  /** Lebende Datensätze aller Stores in einem konsistenten Lesevorgang. */
  loadLive(): Promise<LiveData>;
  /** Alles inklusive Löschmarkierungen. */
  loadSnapshot(): Promise<Snapshot>;
  getHabit(id: string): Promise<Habit | undefined>;
  getCheckIn(habitId: string, localDate: LocalDate): Promise<CheckIn | undefined>;
  commit(changes: ChangeSet): Promise<void>;
  /**
   * Liest und schreibt den Check-in für [habitId, localDate] in einer Transaktion.
   * `update` erhält den bestehenden Eintrag (oder undefined) und liefert den neuen
   * oder `null` (nichts schreiben). Parallele Aufrufe sehen sich gegenseitig.
   */
  upsertCheckIn(
    habitId: string,
    localDate: LocalDate,
    update: (existing: CheckIn | undefined) => Stored<CheckIn> | null,
  ): Promise<Stored<CheckIn> | null>;
  /** Ersetzt den gesamten Bestand transaktional. */
  replaceAll(snapshot: Snapshot): Promise<void>;
  /**
   * Liest den gesamten Bestand und schreibt das Ergebnis von `update` in **einer**
   * Transaktion (z. B. Zusammenführen beim Import). `update` muss synchron sein.
   */
  updateAll(update: (current: Snapshot) => Snapshot): Promise<Snapshot>;
  /** Entfernt die komplette Datenbank. */
  destroy(): Promise<void>;
  close(): void;
}
