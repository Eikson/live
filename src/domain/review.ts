import { appConfig } from './app-config';
import { addDays, startOfWeek, weekdayOf, type LocalDate, type Weekday } from './local-date';
import type { CueConsistency, ReviewDecision, WeeklyReview, WeeklyReviewEntry } from './types';

const cfg = appConfig.review;

/**
 * Die Woche eines Rückblicks: Schlüssel ist der Montag (`weekStart`), betrachtet werden die
 * sieben Tage bis einschließlich Rückblickstag (`from`–`to`). Beim Standard Sonntag ist das
 * genau Montag bis Sonntag.
 */
export interface ReviewWeek {
  weekStart: LocalDate;
  from: LocalDate;
  to: LocalDate;
}

/** Rückblickstag in der Woche, die am Montag `weekStart` beginnt. */
export function reviewDayOf(weekStart: LocalDate, weekday: Weekday): LocalDate {
  return addDays(weekStart, (weekday + 6) % 7);
}

/** Die jüngste Woche, deren Rückblickstag heute oder früher liegt. */
export function latestReviewWeek(today: LocalDate, weekday: Weekday): ReviewWeek {
  let weekStart = startOfWeek(today);
  let to = reviewDayOf(weekStart, weekday);
  if (to > today) {
    weekStart = addDays(weekStart, -7);
    to = addDays(to, -7);
  }
  return { weekStart, from: addDays(to, -6), to };
}

/** Nächster Rückblickstag nach heute. */
export function nextReviewDay(today: LocalDate, weekday: Weekday): LocalDate {
  const delta = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, delta === 0 ? 7 : delta);
}

/**
 * Ein Rückblick steht an, solange es für die jüngste Woche noch keinen Datensatz gibt
 * (erledigt oder übersprungen). Ältere Wochen holt niemand nach: Mit dem nächsten
 * Rückblickstag gilt nur noch die neue Woche.
 */
export function dueReviewWeek(input: {
  today: LocalDate;
  enabled: boolean;
  weekday: Weekday;
  reviews: readonly Pick<WeeklyReview, 'weekStart'>[];
}): ReviewWeek | undefined {
  if (!input.enabled) return undefined;
  const week = latestReviewWeek(input.today, input.weekday);
  return input.reviews.some((r) => r.weekStart === week.weekStart) ? undefined : week;
}

/**
 * Jeder 4. Rückblick fragt nach der Automatik. Gezählt werden die gespeicherten Rückblicke
 * (erledigt oder übersprungen) vor dieser Woche.
 */
export function asksAutomaticity(reviews: readonly Pick<WeeklyReview, 'weekStart'>[], weekStart: LocalDate): boolean {
  const n = reviews.filter((r) => r.weekStart < weekStart).length + 1;
  return n % cfg.automaticityEveryNthReview === 0;
}

// ---------------------------------------------------------------------------
// Vorschläge (Abschnitt 6.6). Es gibt keine Vorschläge zur Steigerung.

export type SuggestionRule = 'NOT_TODAY' | 'EASE' | 'CUE';
export type SuggestionAction = Extract<ReviewDecision, 'SMALLER' | 'CHANGE_CUE'>;

export interface Suggestion {
  rule: SuggestionRule;
  action: SuggestionAction;
  /** Zahl, die im Grund genannt wird: Anzahl „Heute nicht“ oder Leichtigkeit */
  value?: number;
}

export interface SuggestionInput {
  habitId: string;
  /** „Heute nicht“ im betrachteten Zeitraum */
  notTodayCount: number;
  ease?: number;
  cueConsistency?: CueConsistency;
  enabled: boolean;
  snoozes: Readonly<Record<string, LocalDate>>;
  today: LocalDate;
}

export const SUGGESTION_RULES = { notTodayMin: 3, easeMax: 2 } as const;

export function suggestionKey(rule: SuggestionRule, habitId: string): string {
  return `${rule}:${habitId}`;
}

/** Ruht bis einschließlich des gespeicherten Tags. */
export function isSnoozed(snoozes: Readonly<Record<string, LocalDate>>, rule: SuggestionRule, habitId: string, today: LocalDate): boolean {
  const until = snoozes[suggestionKey(rule, habitId)];
  return until !== undefined && today <= until;
}

/** Alle Regeln, die greifen und nicht ruhen, in fester Reihenfolge. */
export function reviewSuggestions(input: SuggestionInput): Suggestion[] {
  if (!input.enabled) return [];
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (!isSnoozed(input.snoozes, s.rule, input.habitId, input.today)) out.push(s);
  };
  if (input.notTodayCount >= SUGGESTION_RULES.notTodayMin) add({ rule: 'NOT_TODAY', action: 'SMALLER', value: input.notTodayCount });
  if (input.ease !== undefined && input.ease <= SUGGESTION_RULES.easeMax) add({ rule: 'EASE', action: 'SMALLER', value: input.ease });
  if (input.cueConsistency === 'RARE') add({ rule: 'CUE', action: 'CHANGE_CUE' });
  return out;
}

/**
 * Nach einem abgeschlossenen Rückblick ruhen Vorschläge, deren Handlung nicht gewählt wurde,
 * 28 Tage je Regel und Habit. Abgelaufene Einträge fallen heraus.
 */
export function snoozesAfterReview(
  snoozes: Readonly<Record<string, LocalDate>>,
  rejected: readonly { rule: SuggestionRule; habitId: string }[],
  today: LocalDate,
): Record<string, LocalDate> {
  const out: Record<string, LocalDate> = {};
  for (const [key, until] of Object.entries(snoozes)) if (until >= today) out[key] = until;
  const until = addDays(today, cfg.suggestionSnoozeDays - 1);
  for (const r of rejected) out[suggestionKey(r.rule, r.habitId)] = until;
  return out;
}

// ---------------------------------------------------------------------------
// Eingaben prüfen

const CUE_VALUES: readonly CueConsistency[] = ['MOST', 'HALF', 'RARE'];
const DECISIONS: readonly ReviewDecision[] = ['KEEP', 'SMALLER', 'CHANGE_CUE', 'PAUSE'];

function scale(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t.slice(0, appConfig.textLimits.long) : undefined;
}

/**
 * Bereinigt einen Eintrag: leere Texte fallen weg, Texte werden gekürzt, Skalen nur 1–5.
 * Automatik nur, wenn danach gefragt wurde und alle vier Aussagen beantwortet sind.
 */
export function normalizeReviewEntry(entry: WeeklyReviewEntry, opts: { automaticity: boolean }): WeeklyReviewEntry {
  const out: WeeklyReviewEntry = { habitId: entry.habitId };
  const helpful = text(entry.helpful);
  const difficult = text(entry.difficult);
  const ease = scale(entry.ease);
  if (helpful) out.helpful = helpful;
  if (difficult) out.difficult = difficult;
  if (ease !== undefined) out.ease = ease;
  if (entry.cueConsistency && CUE_VALUES.includes(entry.cueConsistency)) out.cueConsistency = entry.cueConsistency;
  if (opts.automaticity && Array.isArray(entry.automaticity) && entry.automaticity.length === 4) {
    const values = entry.automaticity.map(scale);
    if (values.every((v) => v !== undefined)) out.automaticity = values as [number, number, number, number];
  }
  if (entry.decision && DECISIONS.includes(entry.decision)) out.decision = entry.decision;
  return out;
}

/** Ein Eintrag ohne jede Angabe wird nicht gespeichert. */
export function isEmptyEntry(entry: WeeklyReviewEntry): boolean {
  return Object.keys(entry).length === 1;
}

/** Mittelwert der vier Aussagen: „deine Einschätzung“, kein Messwert. */
export function automaticityMean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
