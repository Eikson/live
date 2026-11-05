import type { HabitTimeline } from '../habit-history';
import { addDays, diffDays, type LocalDate } from '../local-date';
import type { CheckIn } from '../types';
import { scoringConfig } from './config';
import { quotaValue } from './fulfillment';

const cfg = scoringConfig.integration;

export interface IntegrationInput {
  timeline: HabitTimeline;
  /** Check-ins dieses Habits, nach Tag */
  checkIns: ReadonlyMap<LocalDate, CheckIn>;
  exceptionDays: ReadonlySet<LocalDate>;
  today: LocalDate;
}

export interface IntegrationHistory {
  /** Status am Ende des Tages d (für d ≤ heute). */
  isIntegratedOn(date: LocalDate): boolean;
  /** Aktueller Status (heute). */
  integrated: boolean;
  /** Beginn der aktuellen integrierten Phase. */
  integratedSince?: LocalDate;
  /** Alle Wechsel in zeitlicher Reihenfolge. */
  transitions: { date: LocalDate; integrated: boolean }[];
}

export interface WindowStats {
  planned: number;
  withEntry: number;
  quotaSum: number;
}

/**
 * Fenster [d−29, d]: geplante Tage ohne Ausnahmetage (Pausentage sind nie geplant).
 * Der heutige Tag zählt erst, wenn er eine Angabe hat.
 */
export function windowStats(input: IntegrationInput, day: LocalDate): WindowStats {
  const { timeline, checkIns, exceptionDays, today } = input;
  const stats: WindowStats = { planned: 0, withEntry: 0, quotaSum: 0 };
  for (let i = cfg.windowDays - 1; i >= 0; i--) {
    const d = addDays(day, -i);
    if (!timeline.isPlannedOn(d) || exceptionDays.has(d)) continue;
    const c = checkIns.get(d);
    if (d === today && !c) continue;
    stats.planned++;
    if (!c) continue;
    const q = quotaValue(timeline.habit.kind, c);
    if (q === undefined) continue;
    stats.withEntry++;
    stats.quotaSum += q;
  }
  return stats;
}

/**
 * Integrationsstatus mit Hysterese, ab der Aktivierung Tag für Tag fortgeschrieben.
 * „Integriert“ heißt: regelmäßig umgesetzt – keine Aussage über Automatik.
 */
export function integrationHistory(input: IntegrationInput): IntegrationHistory {
  const { timeline, today } = input;
  const start = timeline.habit.activatedOn;
  const byDay = new Map<LocalDate, boolean>();
  const transitions: { date: LocalDate; integrated: boolean }[] = [];
  let status = false;
  let since: LocalDate | undefined;

  if (start && start <= today) {
    for (let d = start; d <= today; d = addDays(d, 1)) {
      if (timeline.isActiveOn(d) && diffDays(start, d) >= cfg.minDaysSinceActivation) {
        const s = windowStats(input, d);
        const coverage = s.planned === 0 ? 0 : s.withEntry / s.planned;
        if (s.withEntry > 0 && coverage >= cfg.minCoverage) {
          const quota = s.quotaSum / s.withEntry;
          const next: boolean = status ? quota >= cfg.exitBelow : quota >= cfg.enterAt;
          if (next !== status) {
            status = next;
            since = next ? d : undefined;
            transitions.push({ date: d, integrated: next });
          }
        }
      }
      byDay.set(d, status);
    }
  }

  return {
    isIntegratedOn: (date) => {
      if (!start || date < start) return false;
      if (date > today) return status;
      return byDay.get(date) ?? false;
    },
    integrated: status,
    ...(since ? { integratedSince: since } : {}),
    transitions,
  };
}
