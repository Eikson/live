import { addDays, type LocalDate } from '../local-date';
import { scoringConfig } from './config';

const cfg = scoringConfig.comparison;

/** Tageswert oder undefined (Lücke, Ausnahmetag, keine Angabe). */
export type DailyValue = (date: LocalDate) => number | undefined;

export interface WindowMean {
  /** Tage mit Wert im Fenster */
  days: number;
  /** Mittelwert; 0 ohne Tage */
  mean: number;
  /** ab 14 Tagen mit Wert */
  sufficient: boolean;
  from: LocalDate;
  to: LocalDate;
}

export function windowMean(valueOn: DailyValue, end: LocalDate, windowDays: number = cfg.windowDays): WindowMean {
  let days = 0;
  let sum = 0;
  const from = addDays(end, -(windowDays - 1));
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const v = valueOn(d);
    if (v === undefined) continue;
    days++;
    sum += v;
  }
  return { days, mean: days === 0 ? 0 : sum / days, sufficient: days >= cfg.minDays, from, to: end };
}

export type Comparison =
  | { kind: 'SIX_MONTHS'; window: WindowMean }
  | { kind: 'FIRST_WEEKS'; window: WindowMean }
  | { kind: 'NONE' };

/**
 * Vergleichsfenster (Abschnitt 4.6): das 28-Tage-Fenster, das 182 Tage vor heute endet.
 * Reichen die Daten noch keine 6 Monate zurück, gilt das früheste Fenster mit mindestens
 * 14 Tagen („erste Wochen“). Es muss vor dem aktuellen Fenster enden, sonst wäre der
 * Vergleich ein Teil von heute. Sonst gibt es keinen Vergleich.
 *
 * `firstDate` ist der früheste Tag, an dem es überhaupt Werte geben kann.
 */
export function compareWindow(valueOn: DailyValue, today: LocalDate, firstDate: LocalDate | undefined): Comparison {
  if (!firstDate) return { kind: 'NONE' };
  const sixMonths = windowMean(valueOn, addDays(today, -cfg.offsetDays));
  if (sixMonths.sufficient) return { kind: 'SIX_MONTHS', window: sixMonths };
  const fullSixMonths = firstDate <= sixMonths.from;
  if (fullSixMonths) return { kind: 'NONE' };

  const lastEnd = addDays(today, -cfg.windowDays);
  for (let end = addDays(firstDate, cfg.minDays - 1); end <= lastEnd; end = addDays(end, 1)) {
    const w = windowMean(valueOn, end);
    if (w.sufficient) return { kind: 'FIRST_WEEKS', window: w };
  }
  return { kind: 'NONE' };
}
