import type { LiveData } from '../data/repository';
import type { LocalDate } from '../domain/local-date';
import { scoreBook, scoringHabits, type DayScore, type ScoringData, type ScoringHabit } from '../domain/scoring/day-score';
import { evaluatePatterns, type PatternResult } from '../domain/scoring/patterns';
import { wellbeingByDay } from '../domain/scoring/wellbeing';
import type { Derived } from './derived';

/**
 * Score-Eingaben aus den Rohdaten. Alle Habit-Arten zählen (Aufbau und Gegen-Habits),
 * archivierte fallen rückwirkend heraus. Ergebnisse werden nie gespeichert.
 */
export function scoringData(data: LiveData, derived: Derived, opts: { excludePaused?: boolean } = {}): ScoringData {
  const habits: ScoringHabit[] = data.habits
    .filter((h) => h.status !== 'DRAFT')
    .map((h) => {
      const integration = derived.integration(h);
      return {
        timeline: derived.timeline(h),
        checkIns: derived.checkInsOf(h.id),
        isIntegratedOn: (d: LocalDate) => integration.isIntegratedOn(d),
      };
    });
  return { habits: scoringHabits(habits, opts), exceptionDays: derived.exceptionDays };
}

export interface ScoringContext {
  scoreOf: (date: LocalDate) => DayScore;
  wellbeingOn: (date: LocalDate) => number | undefined;
}

export function scoringContext(data: LiveData, derived: Derived, opts: { excludePaused?: boolean } = {}): ScoringContext {
  const wellbeing = wellbeingByDay(data.dayRecords);
  return { scoreOf: scoreBook(scoringData(data, derived, opts)), wellbeingOn: (d) => wellbeing.get(d) };
}

/** Hinweis-Muster für einen Tag (Abschnitt 4.5). */
export function patternsOn(data: LiveData, derived: Derived, date: LocalDate): PatternResult {
  return evaluatePatterns(scoringContext(data, derived), date);
}
