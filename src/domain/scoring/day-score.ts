import type { HabitTimeline } from '../habit-history';
import type { LocalDate } from '../local-date';
import type { CheckIn } from '../types';
import { scoringConfig } from './config';
import { scoreValue } from './fulfillment';

/** Ein Habit mit allem, was der Tagesscore braucht. */
export interface ScoringHabit {
  timeline: HabitTimeline;
  /** Check-ins dieses Habits, nach Tag */
  checkIns: ReadonlyMap<LocalDate, CheckIn>;
  /** Integrationsstatus am Ende des Tages (siehe integrationHistory). */
  isIntegratedOn(date: LocalDate): boolean;
}

export interface ScoringData {
  habits: readonly ScoringHabit[];
  exceptionDays: ReadonlySet<LocalDate>;
}

export interface DayScore {
  date: LocalDate;
  /** Anzahl geplanter Habits */
  planned: number;
  /** Mindestens ein Habit geplant, alle geplanten mit Angabe, kein Ausnahmetag. */
  evaluable: boolean;
  exception: boolean;
  /** Σ gewicht × erfüllung_score über die geplanten Habits */
  score: number;
  /** Decke: Σ gewicht der geplanten Habits */
  ceiling: number;
  /** Σ gewicht der geplanten und an diesem Tag integrierten Habits */
  integratedWeight: number;
  /** Boden: 0,6 × integriertes Gewicht */
  floor: number;
}

/**
 * Archivierte Habits werden rückwirkend überall herausgerechnet (Score, Korridor, Diagramm).
 * Mit `excludePaused` fallen zusätzlich aktuell pausierte Habits heraus (für den Vergleich).
 */
export function scoringHabits<T extends ScoringHabit>(habits: readonly T[], opts: { excludePaused?: boolean } = {}): T[] {
  return habits.filter((h) => {
    const status = h.timeline.habit.status;
    if (status === 'ARCHIVED') return false;
    if (opts.excludePaused && status === 'PAUSED') return false;
    return true;
  });
}

/**
 * Tageswerte nach Abschnitt 4.3. Ein Tag ohne vollständige Angaben ist eine Lücke und zählt
 * nicht als 0. „Trotzdem gemacht“ an nicht geplanten Tagen zählt nie.
 */
export function scoreDay(data: ScoringData, date: LocalDate): DayScore {
  let planned = 0;
  let withEntry = 0;
  let score = 0;
  let ceiling = 0;
  let integratedWeight = 0;
  for (const h of data.habits) {
    if (!h.timeline.isPlannedOn(date)) continue;
    planned++;
    const weight = h.timeline.weightOn(date);
    ceiling += weight;
    if (h.isIntegratedOn(date)) integratedWeight += weight;
    const c = h.checkIns.get(date);
    const value = c ? scoreValue(h.timeline.habit.kind, c) : undefined;
    if (value === undefined) continue;
    withEntry++;
    score += weight * value;
  }
  const exception = data.exceptionDays.has(date);
  return {
    date,
    planned,
    evaluable: planned > 0 && withEntry === planned && !exception,
    exception,
    score,
    ceiling,
    integratedWeight,
    floor: scoringConfig.corridor.floorFactor * integratedWeight,
  };
}

/** Tageswerte mit Zwischenspeicher für eine Berechnung (nie persistiert). */
export function scoreBook(data: ScoringData): (date: LocalDate) => DayScore {
  const cache = new Map<LocalDate, DayScore>();
  return (date) => {
    let s = cache.get(date);
    if (!s) cache.set(date, (s = scoreDay(data, date)));
    return s;
  };
}
