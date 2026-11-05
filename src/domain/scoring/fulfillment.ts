import type { CheckIn, HabitKind } from '../types';
import { scoringConfig } from './config';

const f = scoringConfig.fulfillment;

/**
 * Erfüllungswert einer Angabe für den Score (Tabelle 4.2).
 * `undefined` heißt: zählt nicht (z. B. unbekanntes Ergebnis).
 * Ob der Tag geplant war, entscheidet der Aufrufer – „Trotzdem gemacht“ zählt nie.
 */
export function scoreValue(kind: HabitKind, checkIn: CheckIn): number | undefined {
  return value(kind, checkIn, 'score');
}

/** Erfüllungswert für die Integrationsquote (Minimalversion zählt hier voll). */
export function quotaValue(kind: HabitKind, checkIn: CheckIn): number | undefined {
  return value(kind, checkIn, 'quota');
}

function value(kind: HabitKind, c: CheckIn, mode: 'score' | 'quota'): number | undefined {
  switch (kind) {
    case 'BUILD': {
      const table = f[mode];
      if (c.outcome === 'DONE') return c.minimal ? table.MINIMAL : table.DONE;
      if (c.outcome === 'ALTERNATIVE') return table.ALTERNATIVE;
      if (c.outcome === 'NOT_DONE') return table.NOT_DONE;
      return undefined;
    }
    case 'COUNTER_PROCRASTINATION':
      return c.outcome === 'NO' || c.outcome === 'PARTIAL' || c.outcome === 'YES'
        ? f.procrastination[c.outcome]
        : undefined;
    case 'COUNTER_CUSTOM':
      return c.outcome === 'KEPT' || c.outcome === 'PARTIAL' || c.outcome === 'BROKEN' ? f.custom[c.outcome] : undefined;
    case 'COUNTER_AVOIDANCE':
      if (c.outcome !== 'RECORDED') return undefined;
      return (c.avoidanceItemIds?.length ?? 0) > 0 ? f.avoidance.ANY_CHECKED : f.avoidance.NONE_CHECKED;
  }
}
