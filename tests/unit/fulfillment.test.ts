import { describe, expect, it } from 'vitest';
import { quotaValue, scoreValue } from '../../src/domain/scoring/fulfillment';
import type { CheckIn, CheckInOutcome } from '../../src/domain/types';
import { checkIn } from '../helpers';

const c = (outcome: CheckInOutcome, extra: Partial<CheckIn> = {}): CheckIn => ({
  ...checkIn('h1', '2026-11-05', 'DONE'),
  outcome,
  ...extra,
});

describe('fulfillment', () => {
  it('BUILD: Score-Werte laut Tabelle', () => {
    expect(scoreValue('BUILD', c('DONE'))).toBe(1);
    expect(scoreValue('BUILD', c('DONE', { minimal: true }))).toBe(0.5);
    expect(scoreValue('BUILD', c('ALTERNATIVE'))).toBe(1);
    expect(scoreValue('BUILD', c('NOT_DONE'))).toBe(0);
  });

  it('BUILD: Minimalversion zählt für die Integrationsquote voll', () => {
    expect(quotaValue('BUILD', c('DONE', { minimal: true }))).toBe(1);
    expect(quotaValue('BUILD', c('ALTERNATIVE'))).toBe(1);
    expect(quotaValue('BUILD', c('NOT_DONE'))).toBe(0);
  });

  it('Gegen-Habits', () => {
    expect(scoreValue('COUNTER_PROCRASTINATION', c('NO'))).toBe(1);
    expect(scoreValue('COUNTER_PROCRASTINATION', c('PARTIAL'))).toBe(0.5);
    expect(scoreValue('COUNTER_PROCRASTINATION', c('YES'))).toBe(0);
    expect(scoreValue('COUNTER_CUSTOM', c('KEPT'))).toBe(1);
    expect(scoreValue('COUNTER_CUSTOM', c('PARTIAL'))).toBe(0.5);
    expect(scoreValue('COUNTER_CUSTOM', c('BROKEN'))).toBe(0);
    expect(scoreValue('COUNTER_AVOIDANCE', c('RECORDED', { avoidanceItemIds: [] }))).toBe(1);
    expect(scoreValue('COUNTER_AVOIDANCE', c('RECORDED', { avoidanceItemIds: ['a'] }))).toBe(0);
  });

  it('unpassende Ergebnisse zählen nicht', () => {
    expect(scoreValue('BUILD', c('KEPT'))).toBeUndefined();
    expect(scoreValue('COUNTER_CUSTOM', c('DONE'))).toBeUndefined();
  });
});
