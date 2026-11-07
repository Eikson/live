import { addDays, type LocalDate } from '../local-date';
import { scoringConfig } from './config';
import type { DayScore } from './day-score';

export interface WindowAverage {
  /** Anzahl bewertbarer Tage im Fenster */
  days: number;
  /** Ø Tagesscore; 0, solange es keinen bewertbaren Tag gibt */
  score: number;
  floor: number;
  ceiling: number;
}

/**
 * Durchschnitt über die bewertbaren Tage in [end − (windowDays − 1), end].
 * Lücken und Ausnahmetage fallen heraus, sie zählen nicht als 0.
 */
export function windowAverage(
  scoreOf: (date: LocalDate) => DayScore,
  end: LocalDate,
  windowDays: number = scoringConfig.warning.avgWindowDays,
): WindowAverage {
  let days = 0;
  let score = 0;
  let floor = 0;
  let ceiling = 0;
  for (let i = windowDays - 1; i >= 0; i--) {
    const s = scoreOf(addDays(end, -i));
    if (!s.evaluable) continue;
    days++;
    score += s.score;
    floor += s.floor;
    ceiling += s.ceiling;
  }
  if (days === 0) return { days: 0, score: 0, floor: 0, ceiling: 0 };
  return { days, score: score / days, floor: floor / days, ceiling: ceiling / days };
}

/** Ein 28-Tage-Fenster gilt erst ab 14 bewertbaren Tagen. */
export function isSufficient(window: { days: number }): boolean {
  return window.days >= scoringConfig.comparison.minDays;
}
