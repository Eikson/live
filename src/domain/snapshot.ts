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
} from './types';

/** Vollständiger Bestand inklusive Löschmarkierungen (Grundlage für Export, Import und Zusammenführen). */
export interface Snapshot {
  preferences: Preferences;
  goals: Stored<Goal>[];
  habits: Stored<Habit>[];
  habitEvents: HabitEvent[];
  checkIns: Stored<CheckIn>[];
  dayRecords: DayRecord[];
  avoidanceItems: Stored<AvoidanceItem>[];
  weeklyReviews: WeeklyReview[];
  tasks: Stored<Task>[];
}
