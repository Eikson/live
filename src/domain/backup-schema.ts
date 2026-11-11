import { isLocalDate, type LocalDate, type Weekday } from './local-date';
import type { Snapshot } from './snapshot';
import {
  isTombstone,
  type AvoidanceItem,
  type CheckIn,
  type DayRecord,
  type Goal,
  type Habit,
  type HabitEvent,
  type Preferences,
  type Stored,
  type Task,
  type Tombstone,
  type WeeklyReview,
  type WeeklyReviewEntry,
} from './types';

/**
 * Exportformat (Abschnitt 7). Rein und ohne Browser-APIs: erzeugt die Exportdatei,
 * prüft importierte Dateien vollständig und migriert ältere Formatversionen.
 */
export const BACKUP_FORMAT = 'live-backup';
export const ENCRYPTED_BACKUP_FORMAT = 'live-backup-encrypted';
export const BACKUP_FORMAT_VERSION = 2;
export const ENCRYPTED_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  data: Snapshot;
}

export interface EncryptedBackupFile {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  formatVersion: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  ciphertext: string;
}

export type ParsedBackup = { kind: 'plain'; backup: BackupFile } | { kind: 'encrypted'; envelope: EncryptedBackupFile };

export type BackupErrorCode = 'NOT_JSON' | 'UNKNOWN_FORMAT' | 'NEWER_VERSION' | 'INVALID';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BackupError';
  }
}

/** Hebt eine Datei von Formatversion n−1 auf n (Schlüssel = Zielversion). */
export type BackupMigration = (file: Record<string, unknown>) => Record<string, unknown>;

/** Version 2 ergänzt die Vorhaben; ältere Dateien bekommen eine leere Liste. */
export const backupMigrations: Record<number, BackupMigration> = {
  2: (file) => {
    const data = file.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data) || 'tasks' in data) return file;
    return { ...file, data: { ...data, tasks: [] } };
  },
};

export interface ParseOptions {
  currentVersion?: number;
  migrations?: Record<number, BackupMigration>;
}

/** Obergrenze für PBKDF2-Iterationen beim Import, damit eine Datei die App nicht lahmlegt. */
const MAX_ITERATIONS = 5_000_000;
/** Großzügige Obergrenze für Nutzertexte in importierten Dateien (Zeichen). */
const MAX_TEXT = 5000;

export function createBackup(data: Snapshot, exportedAt: string, appVersion: string): BackupFile {
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt, appVersion, data };
}

/** Liest den Text einer Exportdatei. Verschlüsselte Dateien werden nur äußerlich geprüft. */
export function parseBackupText(text: string, options: ParseOptions = {}): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('NOT_JSON');
  }
  return parseBackupObject(raw, options);
}

export function parseBackupObject(raw: unknown, options: ParseOptions = {}): ParsedBackup {
  if (!isObject(raw)) throw new BackupError('UNKNOWN_FORMAT');
  if (raw.format === ENCRYPTED_BACKUP_FORMAT) return { kind: 'encrypted', envelope: parseEnvelope(raw) };
  if (raw.format !== BACKUP_FORMAT) throw new BackupError('UNKNOWN_FORMAT');

  const current = options.currentVersion ?? BACKUP_FORMAT_VERSION;
  const steps = options.migrations ?? backupMigrations;
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('INVALID', 'formatVersion');
  }
  if (version > current) throw new BackupError('NEWER_VERSION');
  let file: Record<string, unknown> = raw;
  for (let v = version + 1; v <= current; v++) {
    const step = steps[v];
    if (!step) throw new BackupError('INVALID', `Migration ${v} fehlt`);
    file = { ...step(file), format: BACKUP_FORMAT, formatVersion: v };
  }
  return { kind: 'plain', backup: validateBackup(file, current) };
}

function parseEnvelope(raw: Record<string, unknown>): EncryptedBackupFile {
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('INVALID', 'formatVersion');
  }
  if (version > ENCRYPTED_FORMAT_VERSION) throw new BackupError('NEWER_VERSION');
  const kdf = obj(raw.kdf, 'kdf');
  const cipher = obj(raw.cipher, 'cipher');
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw new BackupError('INVALID', 'kdf');
  const iterations = int(kdf.iterations, 'kdf.iterations', 1, MAX_ITERATIONS);
  if (cipher.name !== 'AES-GCM') throw new BackupError('INVALID', 'cipher');
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    formatVersion: version,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: base64(kdf.salt, 'kdf.salt') },
    cipher: { name: 'AES-GCM', iv: base64(cipher.iv, 'cipher.iv') },
    ciphertext: base64(raw.ciphertext, 'ciphertext'),
  };
}

// ---------------------------------------------------------------------------
// Prüfung der Daten. Es werden nur bekannte Felder übernommen.

type Obj = Record<string, unknown>;

function fail(path: string, reason = 'ungültig'): never {
  throw new BackupError('INVALID', `${path}: ${reason}`);
}

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Obj {
  if (!isObject(v)) fail(path, 'kein Objekt');
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'keine Liste');
  return v;
}

function str(v: unknown, path: string, max = MAX_TEXT): string {
  if (typeof v !== 'string') fail(path, 'kein Text');
  if (v.length > max) fail(path, 'zu lang');
  return v;
}

function id(v: unknown, path: string): string {
  const s = str(v, path, 200);
  if (s.length === 0) fail(path, 'leer');
  return s;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'kein Wahrheitswert');
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path, `keine Zahl von ${min} bis ${max}`);
  return v;
}

function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'keine Zahl');
  return v;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function iso(v: unknown, path: string): string {
  if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) fail(path, 'kein Zeitstempel');
  return v;
}

function date(v: unknown, path: string): LocalDate {
  if (!isLocalDate(v)) fail(path, 'kein Kalendertag');
  return v;
}

function time(v: unknown, path: string): string {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(path, 'keine Uhrzeit');
  return v;
}

function oneOf<T extends string>(v: unknown, values: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) fail(path, 'unbekannter Wert');
  return v as T;
}

function base64(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) fail(path, 'kein Base64');
  return v;
}

/** Optionales Feld: fehlt es (oder ist null), bleibt es weg. */
function opt<T>(o: Obj, key: string, path: string, read: (v: unknown, p: string) => T): { [k: string]: T } {
  const v = o[key];
  return v === undefined || v === null ? {} : { [key]: read(v, `${path}.${key}`) };
}

function tombstone(o: Obj, path: string): Tombstone {
  return { id: id(o.id, `${path}.id`), deletedAt: iso(o.deletedAt, `${path}.deletedAt`) };
}

function stored<T>(v: unknown, path: string, read: (o: Obj, p: string) => T): Stored<T> | T {
  const o = obj(v, path);
  return o.deletedAt !== undefined && o.deletedAt !== null ? tombstone(o, path) : read(o, path);
}

const THEMES = ['system', 'light', 'dark'] as const;
const GOAL_STATUS = ['ACTIVE', 'ARCHIVED'] as const;
const HABIT_KINDS = ['BUILD', 'COUNTER_PROCRASTINATION', 'COUNTER_AVOIDANCE', 'COUNTER_CUSTOM'] as const;
const HABIT_STATUS = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
const CUE_TYPES = ['ROUTINE', 'EVENT', 'TIME'] as const;
const EVENT_TYPES = [
  'CREATED',
  'ACTIVATED',
  'EDITED',
  'SCHEDULE_CHANGED',
  'WEIGHT_CHANGED',
  'PAUSED',
  'RESUMED',
  'ARCHIVED',
  'REENTERED',
] as const;
const OUTCOMES_BY_KIND: Record<Habit['kind'], readonly string[]> = {
  BUILD: ['DONE', 'ALTERNATIVE', 'NOT_DONE'],
  COUNTER_PROCRASTINATION: ['NO', 'PARTIAL', 'YES'],
  COUNTER_CUSTOM: ['KEPT', 'PARTIAL', 'BROKEN'],
  COUNTER_AVOIDANCE: ['RECORDED'],
};
const ALL_OUTCOMES = [...new Set(Object.values(OUTCOMES_BY_KIND).flat())] as CheckIn['outcome'][];
const REASONS = ['SICK', 'VACATION', 'OTHER'] as const;
const REVIEW_STATUS = ['COMPLETED', 'SKIPPED'] as const;
const CUE_CONSISTENCY = ['MOST', 'HALF', 'RARE'] as const;
const DECISIONS = ['KEEP', 'SMALLER', 'CHANGE_CUE', 'PAUSE'] as const;
const TASK_STATUS = ['OPEN', 'DONE', 'DROPPED'] as const;
const AVERSION = ['UNCLEAR', 'BORING', 'FEAR', 'TOO_BIG', 'NO_ENERGY', 'OTHER'] as const;
const LATE_CHOICES = ['SMALLER_STEP', 'EARLIER_REVIEW', 'CLEARER_START', 'LESS_PARALLEL', 'CLARIFY', 'SKIPPED'] as const;
const MAX_MINUTES = 6000;

function preferences(v: unknown, path: string): Preferences {
  const o = obj(v, path);
  const snoozes = obj(o.suggestionSnoozes ?? {}, `${path}.suggestionSnoozes`);
  const suggestionSnoozes: Record<string, LocalDate> = {};
  for (const [key, until] of Object.entries(snoozes)) {
    suggestionSnoozes[str(key, `${path}.suggestionSnoozes`, 300)] = date(until, `${path}.suggestionSnoozes.${key}`);
  }
  if (o.id !== undefined && o.id !== 'preferences') fail(`${path}.id`);
  return {
    id: 'preferences',
    theme: oneOf(o.theme, THEMES, `${path}.theme`),
    ...opt(o, 'onboardingCompletedAt', path, iso),
    reviewEnabled: bool(o.reviewEnabled, `${path}.reviewEnabled`),
    reviewWeekday: int(o.reviewWeekday, `${path}.reviewWeekday`, 0, 6) as Preferences['reviewWeekday'],
    suggestionsEnabled: bool(o.suggestionsEnabled, `${path}.suggestionsEnabled`),
    eveningCardFrom: time(o.eveningCardFrom, `${path}.eveningCardFrom`),
    backupReminderEnabled: bool(o.backupReminderEnabled, `${path}.backupReminderEnabled`),
    ...opt(o, 'lastBackupAt', path, iso),
    ...opt(o, 'lastWarningCardAt', path, date),
    ...opt(o, 'warningSnoozedUntil', path, date),
    suggestionSnoozes,
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function goal(o: Obj, path: string): Goal {
  return {
    id: id(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    ...opt(o, 'why', path, str),
    ...opt(o, 'successSignal', path, str),
    status: oneOf(o.status, GOAL_STATUS, `${path}.status`),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function habit(o: Obj, path: string): Habit {
  const kind = oneOf(o.kind, HABIT_KINDS, `${path}.kind`);
  const s = obj(o.schedule, `${path}.schedule`);
  let schedule: Habit['schedule'];
  if (s.type === 'DAILY') schedule = { type: 'DAILY' };
  else if (s.type === 'WEEKDAYS') {
    const days = arr(s.days, `${path}.schedule.days`).map((d, i) => int(d, `${path}.schedule.days[${i}]`, 0, 6));
    if (days.length === 0 || new Set(days).size !== days.length) fail(`${path}.schedule.days`);
    schedule = { type: 'WEEKDAYS', days: days as Weekday[] };
  } else fail(`${path}.schedule.type`);
  const copingPlans = arr(o.copingPlans ?? [], `${path}.copingPlans`).map((c, i) => {
    const p = obj(c, `${path}.copingPlans[${i}]`);
    return { obstacle: str(p.obstacle, `${path}.copingPlans[${i}].obstacle`), response: str(p.response, `${path}.copingPlans[${i}].response`) };
  });
  if (copingPlans.length > 3) fail(`${path}.copingPlans`, 'mehr als 3');
  return {
    id: id(o.id, `${path}.id`),
    ...opt(o, 'goalId', path, id),
    kind,
    actionText: str(o.actionText, `${path}.actionText`),
    ...opt(o, 'minimumText', path, str),
    ...opt(o, 'cue', path, (v, p) => {
      const c = obj(v, p);
      return {
        type: oneOf(c.type, CUE_TYPES, `${p}.type`),
        description: str(c.description, `${p}.description`),
        ...opt(c, 'time', p, time),
      };
    }),
    ...opt(o, 'intention', path, (v, p) => {
      const c = obj(v, p);
      return { ifText: str(c.ifText, `${p}.ifText`), thenText: str(c.thenText, `${p}.thenText`) };
    }),
    copingPlans,
    schedule,
    weight: int(o.weight, `${path}.weight`, 1, 3),
    status: oneOf(o.status, HABIT_STATUS, `${path}.status`),
    ...opt(o, 'activatedOn', path, date),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

/** Freie JSON-Werte im Änderungsprotokoll (`before`/`after`) werden als Kopie übernommen. */
function jsonValue(v: unknown, path: string): unknown {
  try {
    return JSON.parse(JSON.stringify(v)) as unknown;
  } catch {
    return fail(path);
  }
}

function habitEvent(v: unknown, path: string): HabitEvent {
  const o = obj(v, path);
  return {
    id: id(o.id, `${path}.id`),
    habitId: id(o.habitId, `${path}.habitId`),
    localDate: date(o.localDate, `${path}.localDate`),
    at: iso(o.at, `${path}.at`),
    type: oneOf(o.type, EVENT_TYPES, `${path}.type`),
    ...opt(o, 'before', path, jsonValue),
    ...opt(o, 'after', path, jsonValue),
  };
}

function checkIn(o: Obj, path: string): CheckIn {
  return {
    id: id(o.id, `${path}.id`),
    habitId: id(o.habitId, `${path}.habitId`),
    localDate: date(o.localDate, `${path}.localDate`),
    outcome: oneOf(o.outcome, ALL_OUTCOMES, `${path}.outcome`),
    minimal: bool(o.minimal, `${path}.minimal`),
    unplanned: bool(o.unplanned, `${path}.unplanned`),
    ...opt(o, 'avoidanceItemIds', path, (v, p) => arr(v, p).map((x, i) => id(x, `${p}[${i}]`))),
    ...opt(o, 'note', path, str),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function dayRecord(v: unknown, path: string): DayRecord {
  const o = obj(v, path);
  return {
    localDate: date(o.localDate, `${path}.localDate`),
    ...opt(o, 'mood', path, (x, p) => int(x, p, 1, 5)),
    ...opt(o, 'energy', path, (x, p) => int(x, p, 1, 5)),
    ...opt(o, 'exception', path, (x, p) => {
      const e = obj(x, p);
      return { reason: oneOf(e.reason, REASONS, `${p}.reason`), ...opt(e, 'note', p, str) };
    }),
    ...opt(o, 'closedAt', path, iso),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function avoidanceItem(o: Obj, path: string): AvoidanceItem {
  return {
    id: id(o.id, `${path}.id`),
    label: str(o.label, `${path}.label`),
    active: bool(o.active, `${path}.active`),
    order: finite(o.order, `${path}.order`),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function reviewEntry(v: unknown, path: string): WeeklyReviewEntry {
  const o = obj(v, path);
  return {
    habitId: id(o.habitId, `${path}.habitId`),
    ...opt(o, 'helpful', path, str),
    ...opt(o, 'difficult', path, str),
    ...opt(o, 'ease', path, (x, p) => int(x, p, 1, 5)),
    ...opt(o, 'cueConsistency', path, (x, p) => oneOf(x, CUE_CONSISTENCY, p)),
    ...opt(o, 'automaticity', path, (x, p) => {
      const values = arr(x, p).map((n, i) => int(n, `${p}[${i}]`, 1, 5));
      if (values.length !== 4) fail(p, 'nicht 4 Werte');
      return values as [number, number, number, number];
    }),
    ...opt(o, 'decision', path, (x, p) => oneOf(x, DECISIONS, p)),
  };
}

function weeklyReview(v: unknown, path: string): WeeklyReview {
  const o = obj(v, path);
  return {
    id: id(o.id, `${path}.id`),
    weekStart: date(o.weekStart, `${path}.weekStart`),
    status: oneOf(o.status, REVIEW_STATUS, `${path}.status`),
    entries: arr(o.entries, `${path}.entries`).map((e, i) => reviewEntry(e, `${path}.entries[${i}]`)),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function task(o: Obj, path: string): Task {
  const deferrals = arr(o.deferrals ?? [], `${path}.deferrals`).map((v, i) => {
    const p = `${path}.deferrals[${i}]`;
    const d = obj(v, p);
    return { at: iso(d.at, `${p}.at`), from: date(d.from, `${p}.from`), to: date(d.to, `${p}.to`), reason: str(d.reason, `${p}.reason`) };
  });
  return {
    id: id(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    deadline: date(o.deadline, `${path}.deadline`),
    plannedStart: date(o.plannedStart, `${path}.plannedStart`),
    ...opt(o, 'plannedStartTime', path, time),
    firstStep: str(o.firstStep, `${path}.firstStep`),
    estimateMinutes: int(o.estimateMinutes, `${path}.estimateMinutes`, 1, MAX_MINUTES),
    ...opt(o, 'reviewOn', path, date),
    ...opt(o, 'reviewDoneOn', path, date),
    status: oneOf(o.status, TASK_STATUS, `${path}.status`),
    ...opt(o, 'startedOn', path, date),
    ...opt(o, 'startAversion', path, (x, p) => int(x, p, 0, 4)),
    ...opt(o, 'startReason', path, (x, p) => oneOf(x, AVERSION, p)),
    ...opt(o, 'lateStartChoice', path, (x, p) => oneOf(x, LATE_CHOICES, p)),
    deferrals,
    ...opt(o, 'finishedOn', path, date),
    ...opt(o, 'actualMinutes', path, (x, p) => int(x, p, 1, MAX_MINUTES)),
    createdOn: date(o.createdOn, `${path}.createdOn`),
    createdAt: iso(o.createdAt, `${path}.createdAt`),
    updatedAt: iso(o.updatedAt, `${path}.updatedAt`),
  };
}

function list<T>(data: Obj, key: string, read: (v: unknown, path: string) => T): T[] {
  return arr(data[key], `data.${key}`).map((v, i) => read(v, `data.${key}[${i}]`));
}

function unique<T>(items: T[], keyOf: (item: T) => string | undefined, path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    if (seen.has(key)) fail(path, `doppelt: ${key}`);
    seen.add(key);
  }
}

/** Prüft Felder, Eindeutigkeit und Bezüge. Liefert eine bereinigte Kopie. */
export function validateSnapshot(raw: unknown): Snapshot {
  const data = obj(raw, 'data');
  const snapshot: Snapshot = {
    preferences: preferences(data.preferences, 'data.preferences'),
    goals: list(data, 'goals', (v, p) => stored(v, p, goal)),
    habits: list(data, 'habits', (v, p) => stored(v, p, habit)),
    habitEvents: list(data, 'habitEvents', habitEvent),
    checkIns: list(data, 'checkIns', (v, p) => stored(v, p, checkIn)),
    dayRecords: list(data, 'dayRecords', dayRecord),
    avoidanceItems: list(data, 'avoidanceItems', (v, p) => stored(v, p, avoidanceItem)),
    weeklyReviews: list(data, 'weeklyReviews', weeklyReview),
    tasks: list(data, 'tasks', (v, p) => stored(v, p, task)),
  };

  unique(snapshot.goals, (g) => g.id, 'data.goals');
  unique(snapshot.habits, (h) => h.id, 'data.habits');
  unique(snapshot.habitEvents, (e) => e.id, 'data.habitEvents');
  unique(snapshot.checkIns, (c) => c.id, 'data.checkIns');
  unique(snapshot.checkIns, (c) => (isTombstone(c) ? undefined : `${c.habitId}|${c.localDate}`), 'data.checkIns');
  unique(snapshot.dayRecords, (d) => d.localDate, 'data.dayRecords');
  unique(snapshot.avoidanceItems, (a) => a.id, 'data.avoidanceItems');
  unique(snapshot.weeklyReviews, (r) => r.id, 'data.weeklyReviews');
  unique(snapshot.weeklyReviews, (r) => r.weekStart, 'data.weeklyReviews');
  unique(snapshot.tasks, (t) => t.id, 'data.tasks');
  for (const t of snapshot.tasks) {
    if (!isTombstone(t) && t.status === 'DONE' && t.finishedOn === undefined) fail('data.tasks', `Abschluss fehlt: ${t.id}`);
  }

  // Keine verwaisten Datensätze: Bezüge zeigen auf lebende Ziele und Habits.
  const goals = new Set(snapshot.goals.filter((g) => !isTombstone(g)).map((g) => g.id));
  const habits = new Map<string, Habit>();
  for (const h of snapshot.habits) if (!isTombstone(h)) habits.set(h.id, h);
  for (const h of habits.values()) {
    if (h.goalId !== undefined && !goals.has(h.goalId)) fail('data.habits', `Ziel fehlt: ${h.goalId}`);
  }
  for (const c of snapshot.checkIns) {
    if (isTombstone(c)) continue;
    const owner = habits.get(c.habitId);
    if (!owner) fail('data.checkIns', `Habit fehlt: ${c.habitId}`);
    if (!OUTCOMES_BY_KIND[owner.kind].includes(c.outcome)) fail('data.checkIns', `Ergebnis passt nicht: ${c.id}`);
  }
  for (const e of snapshot.habitEvents) {
    if (!habits.has(e.habitId)) fail('data.habitEvents', `Habit fehlt: ${e.habitId}`);
  }
  for (const r of snapshot.weeklyReviews) {
    for (const e of r.entries) if (!habits.has(e.habitId)) fail('data.weeklyReviews', `Habit fehlt: ${e.habitId}`);
  }
  return snapshot;
}

function validateBackup(file: Obj, version: number): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: version,
    exportedAt: iso(file.exportedAt, 'exportedAt'),
    appVersion: str(file.appVersion, 'appVersion', 50),
    data: validateSnapshot(file.data),
  };
}

export interface BackupSummary {
  exportedAt: string;
  goals: number;
  habits: number;
  checkIns: number;
  tasks: number;
  /** Zeitraum der Check-ins, falls vorhanden */
  from?: LocalDate;
  to?: LocalDate;
}

/** Vorschau vor dem Import: nur lebende Datensätze zählen. */
export function backupSummary(backup: BackupFile): BackupSummary {
  const { data } = backup;
  const checkIns = data.checkIns.filter((c): c is CheckIn => !isTombstone(c));
  const dates = checkIns.map((c) => c.localDate).sort();
  return {
    exportedAt: backup.exportedAt,
    goals: data.goals.filter((g) => !isTombstone(g)).length,
    habits: data.habits.filter((h) => !isTombstone(h)).length,
    checkIns: checkIns.length,
    tasks: data.tasks.filter((t) => !isTombstone(t)).length,
    ...(dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : {}),
  };
}
