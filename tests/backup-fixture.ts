import { defaultPreferences } from '../src/domain/preferences';
import type { Snapshot } from '../src/domain/snapshot';
import { checkIn, event, makeHabit, NOW } from './helpers';

/** Ein kleiner, vollständiger Bestand für Export-, Import- und Zusammenführungstests. */
export function sampleSnapshot(): Snapshot {
  return {
    preferences: { ...defaultPreferences(NOW), onboardingCompletedAt: NOW },
    goals: [{ id: 'g1', title: 'Mehr Bewegung', why: 'Rücken', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }],
    habits: [makeHabit({ id: 'h1', goalId: 'g1' }), { id: 'h-alt', deletedAt: NOW }],
    habitEvents: [{ ...event('h1', '2026-01-01', 'CREATED'), id: 'ev-1', at: NOW }],
    checkIns: [
      { ...checkIn('h1', '2026-01-01', 'DONE'), note: 'Schön <b>draußen</b>' },
      checkIn('h1', '2026-01-03', 'ALTERNATIVE', true),
    ],
    dayRecords: [{ localDate: '2026-01-01', mood: 4, energy: 3, closedAt: NOW, updatedAt: NOW }],
    avoidanceItems: [{ id: 'a1', label: 'Handy', active: true, order: 0, createdAt: NOW, updatedAt: NOW }],
    weeklyReviews: [
      {
        id: 'r1',
        weekStart: '2025-12-29',
        status: 'COMPLETED',
        entries: [{ habitId: 'h1', ease: 3, decision: 'KEEP' }],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}
