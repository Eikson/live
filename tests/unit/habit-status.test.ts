import { describe, expect, it } from 'vitest';
import { countBuilding, hasFreeBuildingSlot, transition } from '../../src/domain/habit-status';
import { makeHabit } from '../helpers';

describe('habit-status', () => {
  const notIntegrated = () => false;

  it('aktiviert einen Entwurf, solange ein Platz im Aufbau frei ist', () => {
    const draft = makeHabit({ status: 'DRAFT' });
    expect(transition(draft, 'ACTIVATE', { buildingCount: 1 })).toEqual({ ok: true, next: 'ACTIVE' });
    expect(transition(draft, 'ACTIVATE', { buildingCount: 2 })).toEqual({ ok: false, reason: 'BUILD_LIMIT_REACHED' });
  });

  it('Fortsetzen braucht ebenfalls einen freien Platz', () => {
    const paused = makeHabit({ status: 'PAUSED' });
    expect(transition(paused, 'RESUME', { buildingCount: 2 }).ok).toBe(false);
    expect(transition(paused, 'RESUME', { buildingCount: 1 }).ok).toBe(true);
  });

  it('Gegen-Habits zählen nicht zur Grenze', () => {
    const counter = makeHabit({ kind: 'COUNTER_CUSTOM', status: 'DRAFT' });
    expect(transition(counter, 'ACTIVATE', { buildingCount: 2 }).ok).toBe(true);
    expect(countBuilding([makeHabit({ kind: 'COUNTER_CUSTOM' }), makeHabit({ id: 'h2' })], notIntegrated)).toBe(1);
  });

  it('integrierte Habits belegen keinen Platz', () => {
    const habits = [makeHabit({ id: 'a' }), makeHabit({ id: 'b' })];
    expect(hasFreeBuildingSlot(habits, notIntegrated)).toBe(false);
    expect(hasFreeBuildingSlot(habits, (h) => h.id === 'a')).toBe(true);
  });

  it('lehnt ungültige Wechsel ab', () => {
    expect(transition(makeHabit({ status: 'ARCHIVED' }), 'RESUME', { buildingCount: 0 })).toEqual({
      ok: false,
      reason: 'INVALID_TRANSITION',
    });
    expect(transition(makeHabit(), 'ACTIVATE', { buildingCount: 0 }).ok).toBe(false);
    expect(transition(makeHabit(), 'PAUSE', { buildingCount: 2 })).toEqual({ ok: true, next: 'PAUSED' });
  });
});
