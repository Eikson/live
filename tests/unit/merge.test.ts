import { describe, expect, it } from 'vitest';
import { mergeSnapshots } from '../../src/domain/merge';
import type { Snapshot } from '../../src/domain/snapshot';
import { isTombstone, type CheckIn, type Goal } from '../../src/domain/types';
import { checkIn, makeHabit } from '../helpers';
import { sampleSnapshot } from '../backup-fixture';

const T0 = '2026-01-01T08:00:00.000Z';
const T1 = '2026-01-02T08:00:00.000Z';
const T2 = '2026-01-03T08:00:00.000Z';

function base(): Snapshot {
  return sampleSnapshot();
}
const goal = (patch: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  title: 'Mehr Bewegung',
  status: 'ACTIVE',
  createdAt: T0,
  updatedAt: T0,
  ...patch,
});
const ci = (patch: Partial<CheckIn> & { habitId?: string; localDate?: string }): CheckIn => ({
  ...checkIn(patch.habitId ?? 'h1', patch.localDate ?? '2026-01-05', 'DONE'),
  ...patch,
});

describe('Zusammenführen', () => {
  it('ist mit sich selbst neutral', () => {
    expect(mergeSnapshots(base(), base())).toEqual(base());
  });

  it('der neuere Stand gewinnt, egal von welcher Seite', () => {
    const local = { ...base(), goals: [goal({ title: 'lokal', updatedAt: T2 })] };
    const incoming = { ...base(), goals: [goal({ title: 'Datei', updatedAt: T1 })] };
    expect((mergeSnapshots(local, incoming).goals[0] as Goal).title).toBe('lokal');
    expect((mergeSnapshots(incoming, local).goals[0] as Goal).title).toBe('lokal');
  });

  it('gleich alt: die Löschmarkierung gewinnt, sonst bleibt der lokale Stand', () => {
    const a = { ...base(), avoidanceItems: [{ id: 'a1', label: 'lokal', active: true, order: 0, createdAt: T0, updatedAt: T1 }] };
    const b = { ...base(), avoidanceItems: [{ id: 'a1', label: 'Datei', active: true, order: 0, createdAt: T0, updatedAt: T1 }] };
    expect(mergeSnapshots(a, b).avoidanceItems[0]).toMatchObject({ label: 'lokal' });

    const deleted = { ...base(), avoidanceItems: [{ id: 'a1', deletedAt: T1 }] };
    expect(isTombstone(mergeSnapshots(a, deleted).avoidanceItems[0]!)).toBe(true);
    expect(isTombstone(mergeSnapshots(deleted, a).avoidanceItems[0]!)).toBe(true);
  });

  it('eine ältere Löschung hebt einen neueren Stand nicht auf', () => {
    const living = { ...base(), avoidanceItems: [{ id: 'a1', label: 'neu', active: true, order: 0, createdAt: T0, updatedAt: T2 }] };
    const deleted = { ...base(), avoidanceItems: [{ id: 'a1', deletedAt: T1 }] };
    expect(mergeSnapshots(deleted, living).avoidanceItems[0]).toMatchObject({ label: 'neu' });
  });

  it('übernimmt neue Datensätze aus der Datei und behält lokale', () => {
    const incoming = base();
    incoming.goals.push(goal({ id: 'g2', title: 'Neu' }));
    incoming.habits.push(makeHabit({ id: 'h2', goalId: 'g2' }));
    incoming.checkIns.push(ci({ id: 'c-h2', habitId: 'h2' }));
    const merged = mergeSnapshots(base(), incoming);
    expect(merged.goals.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(merged.habits.map((h) => h.id)).toEqual(['h1', 'h-alt', 'h2']);
    expect(merged.checkIns.map((c) => c.id)).toContain('c-h2');
  });

  it('Check-ins mit verschiedener ID am selben Tag: der neuere bleibt, der andere wird gelöscht', () => {
    const local = { ...base(), checkIns: [ci({ id: 'lokal', updatedAt: T1 })] };
    const incoming = { ...base(), checkIns: [ci({ id: 'datei', outcome: 'ALTERNATIVE', updatedAt: T2 })] };
    const merged = mergeSnapshots(local, incoming).checkIns;
    const living = merged.filter((c) => !isTombstone(c));
    expect(living.map((c) => c.id)).toEqual(['datei']);
    expect(merged.find((c) => c.id === 'lokal')).toEqual({ id: 'lokal', deletedAt: T2 });

    // Gleich alt: der lokale bleibt.
    const tie = { ...base(), checkIns: [ci({ id: 'datei', updatedAt: T1 })] };
    expect(mergeSnapshots(local, tie).checkIns.filter((c) => !isTombstone(c)).map((c) => c.id)).toEqual(['lokal']);
  });

  it('löscht Habits gelöschter Ziele samt Check-ins, Ereignissen und Rückblick-Einträgen', () => {
    const incoming = { ...base(), goals: [{ id: 'g1', deletedAt: T2 }] };
    const merged = mergeSnapshots(base(), incoming);
    expect(merged.habits.find((h) => h.id === 'h1')).toEqual({ id: 'h1', deletedAt: T2 });
    expect(merged.checkIns.every(isTombstone)).toBe(true);
    expect(merged.habitEvents).toEqual([]);
    expect(merged.weeklyReviews[0]!.entries).toEqual([]);
  });

  it('Tagesabschlüsse je Datum: der neuere gewinnt', () => {
    const local = { ...base(), dayRecords: [{ localDate: '2026-01-01', mood: 2 as const, updatedAt: T2 }] };
    const incoming = { ...base(), dayRecords: [{ localDate: '2026-01-01', mood: 5 as const, updatedAt: T1 }] };
    expect(mergeSnapshots(local, incoming).dayRecords).toEqual(local.dayRecords);
    expect(mergeSnapshots(incoming, local).dayRecords).toEqual(local.dayRecords);
  });

  it('je Woche höchstens ein Rückblick', () => {
    const incoming = base();
    incoming.weeklyReviews = [{ ...incoming.weeklyReviews[0]!, id: 'r2', updatedAt: T2 }];
    const merged = mergeSnapshots(base(), incoming);
    expect(merged.weeklyReviews.map((r) => r.id)).toEqual(['r2']);
  });

  it('Ereignisse werden vereinigt', () => {
    const incoming = base();
    incoming.habitEvents.push({ id: 'ev-2', habitId: 'h1', type: 'PAUSED', localDate: '2026-01-04', at: T1 });
    expect(mergeSnapshots(base(), incoming).habitEvents.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
  });

  it('Einstellungen: neuere gewinnen, erster Start bleibt der früheste, letzter Export der späteste', () => {
    const local = base();
    local.preferences = { ...local.preferences, theme: 'dark', updatedAt: T2, onboardingCompletedAt: T1, lastBackupAt: T1 };
    const incoming = base();
    incoming.preferences = { ...incoming.preferences, theme: 'light', updatedAt: T1, onboardingCompletedAt: T0, lastBackupAt: T2 };
    expect(mergeSnapshots(local, incoming).preferences).toMatchObject({
      theme: 'dark',
      onboardingCompletedAt: T0,
      lastBackupAt: T2,
    });
  });
});
