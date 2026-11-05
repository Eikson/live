import type { DBSchema } from 'idb';
import type { LocalDate } from '../domain/local-date';
import type {
  AvoidanceItem,
  CheckIn,
  DayRecord,
  Goal,
  Habit,
  HabitEvent,
  Preferences,
  Stored,
  WeeklyReview,
} from '../domain/types';

export const DB_NAME = 'live';
/** Aktuelle Schema-Version. Jede Erhöhung braucht eine Migration in `migrations.ts`. */
export const DB_VERSION = 1;

export interface MetaRecord {
  key: 'dbVersion' | 'exportFormatVersion';
  value: number;
}

export interface LiveDB extends DBSchema {
  preferences: { key: string; value: Preferences };
  goals: { key: string; value: Stored<Goal> };
  habits: { key: string; value: Stored<Habit>; indexes: { goalId: string } };
  habitEvents: { key: string; value: HabitEvent; indexes: { habitId: string } };
  checkIns: {
    key: string;
    value: Stored<CheckIn>;
    indexes: { habitId: string; localDate: LocalDate; habitId_localDate: [string, LocalDate] };
  };
  dayRecords: { key: LocalDate; value: DayRecord };
  avoidanceItems: { key: string; value: Stored<AvoidanceItem> };
  weeklyReviews: { key: string; value: WeeklyReview; indexes: { weekStart: LocalDate } };
  meta: { key: string; value: MetaRecord };
}

export type StoreName =
  | 'preferences'
  | 'goals'
  | 'habits'
  | 'habitEvents'
  | 'checkIns'
  | 'dayRecords'
  | 'avoidanceItems'
  | 'weeklyReviews'
  | 'meta';

export const ALL_STORES: StoreName[] = [
  'preferences',
  'goals',
  'habits',
  'habitEvents',
  'checkIns',
  'dayRecords',
  'avoidanceItems',
  'weeklyReviews',
  'meta',
];
