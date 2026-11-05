import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/domain/habit-history';
import { event, makeHabit } from '../helpers';

describe('habit-history', () => {
  it('ohne Protokoll: vor activatedOn Entwurf, danach aktiv', () => {
    const t = buildTimeline(makeHabit({ activatedOn: '2026-01-10' }), []);
    expect(t.statusOn('2026-01-09')).toBe('DRAFT');
    expect(t.isPlannedOn('2026-01-09')).toBe(false);
    expect(t.statusOn('2026-01-10')).toBe('ACTIVE');
    expect(t.isPlannedOn('2026-01-10')).toBe(true);
  });

  it('eine Rhythmusänderung gilt ab ihrem Tag, frühere Tage behalten den alten Rhythmus', () => {
    const habit = makeHabit({ schedule: { type: 'WEEKDAYS', days: [1] } });
    const events = [
      event('h1', '2026-01-01', 'ACTIVATED', 'DRAFT', 'ACTIVE'),
      event('h1', '2026-01-07', 'SCHEDULE_CHANGED', { type: 'DAILY' }, { type: 'WEEKDAYS', days: [1] }),
    ];
    const t = buildTimeline(habit, events);
    expect(t.scheduleOn('2026-01-06')).toEqual({ type: 'DAILY' });
    expect(t.isPlannedOn('2026-01-06')).toBe(true); // Dienstag, damals täglich
    expect(t.isPlannedOn('2026-01-13')).toBe(false); // Dienstag, jetzt nur montags
    expect(t.isPlannedOn('2026-01-12')).toBe(true); // Montag
  });

  it('Gewichtsänderungen gelten ab ihrem Tag', () => {
    const habit = makeHabit({ weight: 3 });
    const events = [event('h1', '2026-01-05', 'WEIGHT_CHANGED', 1, 3)];
    const t = buildTimeline(habit, events);
    expect(t.weightOn('2026-01-04')).toBe(1);
    expect(t.weightOn('2026-01-05')).toBe(3);
  });

  it('Pausentage sind weder aktiv noch geplant', () => {
    const habit = makeHabit();
    const events = [
      event('h1', '2026-01-01', 'ACTIVATED', 'DRAFT', 'ACTIVE'),
      event('h1', '2026-01-10', 'PAUSED', 'ACTIVE', 'PAUSED'),
      event('h1', '2026-01-20', 'RESUMED', 'PAUSED', 'ACTIVE'),
    ];
    const t = buildTimeline(habit, events);
    expect(t.isPlannedOn('2026-01-09')).toBe(true);
    expect(t.statusOn('2026-01-10')).toBe('PAUSED');
    expect(t.isPlannedOn('2026-01-15')).toBe(false);
    expect(t.isPlannedOn('2026-01-20')).toBe(true);
    expect(t.statusOn('2025-12-31')).toBe('DRAFT');
  });

  it('ignoriert Ereignisse anderer Habits und sortiert nach Tag und Zeit', () => {
    const habit = makeHabit();
    const events = [
      event('h1', '2026-01-10', 'PAUSED', 'ACTIVE', 'PAUSED'),
      event('other', '2026-01-05', 'PAUSED', 'ACTIVE', 'PAUSED'),
      event('h1', '2026-01-01', 'ACTIVATED', 'DRAFT', 'ACTIVE'),
    ];
    const t = buildTimeline(habit, events);
    expect(t.statusOn('2026-01-05')).toBe('ACTIVE');
    expect(t.statusOn('2026-01-10')).toBe('PAUSED');
  });
});
