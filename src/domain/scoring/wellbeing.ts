import type { LocalDate } from '../local-date';
import type { DayRecord } from '../types';
import { scoringConfig } from './config';
import type { DayScore } from './day-score';

const cfg = scoringConfig.warning;

/** Befinden: Mittelwert der vorhandenen Werte aus Stimmung und Energie (1–5), sonst undefined. */
export function wellbeingOf(record: Pick<DayRecord, 'mood' | 'energy'> | undefined): number | undefined {
  if (!record) return undefined;
  const values = [record.mood, record.energy].filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Befinden je Tag. Ausnahmetage fallen heraus, sie zählen in keinem Durchschnitt. */
export function wellbeingByDay(records: readonly DayRecord[]): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const r of records) {
    if (r.exception) continue;
    const w = wellbeingOf(r);
    if (w !== undefined) out.set(r.localDate, w);
  }
  return out;
}

/**
 * Toleranz der Hinweislogik: 0,4 bei niedrigem Befinden (≤ 2), sonst 0,6, auch ohne Angabe.
 * Befinden wirkt nur hier. Score und Boden bleiben davon unberührt.
 */
export function toleranceFor(wellbeing: number | undefined): number {
  return wellbeing !== undefined && wellbeing <= cfg.lowWellbeingMax ? cfg.toleranceLowWellbeing : cfg.tolerance;
}

/** Tagesgrenze(d) = Toleranz(d) × Σ gewicht der integrierten geplanten Habits. */
export function dayLimit(day: DayScore, wellbeing: number | undefined): number {
  return toleranceFor(wellbeing) * day.integratedWeight;
}
