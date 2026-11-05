import type { LocalDate, Weekday } from './local-date';

/** ISO-8601-Zeitstempel, z. B. `2026-11-05T09:12:00.000Z`. */
export type IsoTimestamp = string;

/** Löschmarkierung: nur `id` und `deletedAt` bleiben erhalten (für das Zusammenführen). */
export interface Tombstone {
  id: string;
  deletedAt: IsoTimestamp;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Preferences {
  id: 'preferences';
  theme: Theme;
  onboardingCompletedAt?: IsoTimestamp;
  reviewEnabled: boolean;
  reviewWeekday: Weekday;
  suggestionsEnabled: boolean;
  /** `HH:MM` */
  eveningCardFrom: string;
  backupReminderEnabled: boolean;
  lastBackupAt?: IsoTimestamp;
  lastWarningCardAt?: LocalDate;
  warningSnoozedUntil?: LocalDate;
  /** Schlüssel `${regel}:${habitId}` → ruht bis einschließlich LocalDate */
  suggestionSnoozes: Record<string, LocalDate>;
  updatedAt: IsoTimestamp;
}

export type GoalStatus = 'ACTIVE' | 'ARCHIVED';

export interface Goal {
  id: string;
  title: string;
  why?: string;
  successSignal?: string;
  status: GoalStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type HabitKind = 'BUILD' | 'COUNTER_PROCRASTINATION' | 'COUNTER_AVOIDANCE' | 'COUNTER_CUSTOM';
export type HabitStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type CueType = 'ROUTINE' | 'EVENT' | 'TIME';

export interface Cue {
  type: CueType;
  description: string;
  /** `HH:MM`, nur bei TIME */
  time?: string;
}

export interface Intention {
  ifText: string;
  thenText: string;
}

export interface CopingPlan {
  obstacle: string;
  response: string;
}

export type Schedule = { type: 'DAILY' } | { type: 'WEEKDAYS'; days: Weekday[] };

export interface Habit {
  id: string;
  goalId?: string;
  kind: HabitKind;
  actionText: string;
  /** Pflicht bei BUILD, fehlt bei Gegen-Habits */
  minimumText?: string;
  cue?: Cue;
  intention?: Intention;
  copingPlans: CopingPlan[];
  schedule: Schedule;
  weight: number;
  status: HabitStatus;
  activatedOn?: LocalDate;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type HabitEventType =
  | 'CREATED'
  | 'ACTIVATED'
  | 'EDITED'
  | 'SCHEDULE_CHANGED'
  | 'WEIGHT_CHANGED'
  | 'PAUSED'
  | 'RESUMED'
  | 'ARCHIVED'
  | 'REENTERED';

/** Änderungsprotokoll: wird nur ergänzt, nie geändert. */
export interface HabitEvent {
  id: string;
  habitId: string;
  localDate: LocalDate;
  at: IsoTimestamp;
  type: HabitEventType;
  before?: unknown;
  after?: unknown;
}

export type BuildOutcome = 'DONE' | 'ALTERNATIVE' | 'NOT_DONE';
export type ProcrastinationOutcome = 'NO' | 'PARTIAL' | 'YES';
export type CustomOutcome = 'KEPT' | 'PARTIAL' | 'BROKEN';
export type AvoidanceOutcome = 'RECORDED';
export type CheckInOutcome = BuildOutcome | ProcrastinationOutcome | CustomOutcome | AvoidanceOutcome;

export interface CheckIn {
  id: string;
  habitId: string;
  localDate: LocalDate;
  outcome: CheckInOutcome;
  minimal: boolean;
  unplanned: boolean;
  avoidanceItemIds?: string[];
  note?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type ExceptionReason = 'SICK' | 'VACATION' | 'OTHER';

export interface DayRecord {
  localDate: LocalDate;
  mood?: number;
  energy?: number;
  exception?: { reason: ExceptionReason; note?: string };
  closedAt?: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface AvoidanceItem {
  id: string;
  label: string;
  active: boolean;
  order: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type CueConsistency = 'MOST' | 'HALF' | 'RARE';
export type ReviewDecision = 'KEEP' | 'SMALLER' | 'CHANGE_CUE' | 'PAUSE';

export interface WeeklyReviewEntry {
  habitId: string;
  helpful?: string;
  difficult?: string;
  ease?: number;
  cueConsistency?: CueConsistency;
  automaticity?: [number, number, number, number];
  decision?: ReviewDecision;
}

export interface WeeklyReview {
  id: string;
  /** Montag der Woche */
  weekStart: LocalDate;
  status: 'COMPLETED' | 'SKIPPED';
  entries: WeeklyReviewEntry[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Ein löschbarer Datensatz ist entweder lebendig oder eine Löschmarkierung. */
export type Stored<T> = T | Tombstone;

export function isTombstone(value: { id: string } | Tombstone): value is Tombstone {
  return 'deletedAt' in value && typeof (value as Tombstone).deletedAt === 'string';
}
