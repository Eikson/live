import { addDays, diffDays, type LocalDate } from '../local-date';
import { scoringConfig } from './config';
import { windowAverage } from './corridor';
import type { DayScore } from './day-score';
import { dayLimit } from './wellbeing';

const cfg = scoringConfig.warning;

export interface PatternInput {
  scoreOf: (date: LocalDate) => DayScore;
  wellbeingOn: (date: LocalDate) => number | undefined;
}

export interface PatternResult {
  /** Bewertbare Tage unter der Tagesgrenze in den letzten 7 Kalendertagen */
  daysBelow: number;
  shortTerm: boolean;
  longTerm: boolean;
  due: boolean;
}

/**
 * Hinweis nur bei Mustern (Abschnitt 4.5), ausgewertet für den Tag `date`.
 * 1. kurzfristig: mindestens 5 bewertbare Tage mit Tagesscore < Tagesgrenze in [date−6, date]
 * 2. langfristig: Ø28Score < Ø28Boden bei mindestens 14 bewertbaren Tagen
 * Einzelne Tage lösen nie etwas aus. Ohne integrierte Habits sind Grenze und Boden 0.
 */
export function evaluatePatterns(input: PatternInput, date: LocalDate): PatternResult {
  let daysBelow = 0;
  for (let i = cfg.patternWindowDays - 1; i >= 0; i--) {
    const d = addDays(date, -i);
    const s = input.scoreOf(d);
    // Heute zählt nur, wenn der Tag schon bewertbar ist; Lücken und Ausnahmetage zählen nie.
    if (!s.evaluable) continue;
    if (s.score < dayLimit(s, input.wellbeingOn(d))) daysBelow++;
  }
  const shortTerm = daysBelow >= cfg.patternMinDaysBelow;
  const avg = windowAverage(input.scoreOf, date, cfg.avgWindowDays);
  const longTerm = avg.days >= cfg.avgMinDays && avg.score < avg.floor;
  return { daysBelow, shortTerm, longTerm, due: shortTerm || longTerm };
}

export interface HintCardInput {
  due: boolean;
  today: LocalDate;
  lastShownAt?: LocalDate;
  snoozedUntil?: LocalDate;
}

/**
 * Karte auf „Heute“: höchstens einmal pro 7 Tage. Am Tag, an dem sie erschienen ist, bleibt sie
 * sichtbar, bis du sie schließt. „So lassen“ (und jede andere Wahl) blendet sie 7 Tage aus:
 * `snoozedUntil` ist der erste Tag, an dem sie wieder erscheinen darf.
 */
export function shouldShowHintCard({ due, today, lastShownAt, snoozedUntil }: HintCardInput): boolean {
  if (!due) return false;
  if (snoozedUntil && today < snoozedUntil) return false;
  if (!lastShownAt || lastShownAt === today) return true;
  return diffDays(lastShownAt, today) >= cfg.cardCooldownDays;
}

/** Erster Tag, an dem die Karte nach einer Wahl wieder erscheinen darf. */
export function hintSnoozeUntil(today: LocalDate): LocalDate {
  return addDays(today, cfg.cardCooldownDays);
}
