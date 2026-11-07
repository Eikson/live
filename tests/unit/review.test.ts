import { describe, expect, it } from 'vitest';
import {
  asksAutomaticity,
  automaticityMean,
  dueReviewWeek,
  isEmptyEntry,
  latestReviewWeek,
  nextReviewDay,
  normalizeReviewEntry,
  reviewDayOf,
  reviewSuggestions,
  snoozesAfterReview,
  type SuggestionInput,
} from '../../src/domain/review';
import type { WeeklyReviewEntry } from '../../src/domain/types';

// 2026-11-02 ist ein Montag, 2026-11-08 ein Sonntag.
describe('Rückblickswoche', () => {
  it('liegt beim Standard Sonntag genau auf Montag bis Sonntag', () => {
    expect(reviewDayOf('2026-11-02', 0)).toBe('2026-11-08');
    expect(latestReviewWeek('2026-11-08', 0)).toEqual({ weekStart: '2026-11-02', from: '2026-11-02', to: '2026-11-08' });
  });

  it('gehört vor dem Rückblickstag noch zur Vorwoche', () => {
    expect(latestReviewWeek('2026-11-07', 0)).toEqual({ weekStart: '2026-10-26', from: '2026-10-26', to: '2026-11-01' });
  });

  it('umfasst bei anderem Wochentag die sieben Tage bis dahin', () => {
    // Mittwoch als Rückblickstag
    expect(latestReviewWeek('2026-11-04', 3)).toEqual({ weekStart: '2026-11-02', from: '2026-10-29', to: '2026-11-04' });
    expect(latestReviewWeek('2026-11-03', 3)).toEqual({ weekStart: '2026-10-26', from: '2026-10-22', to: '2026-10-28' });
    // Montag als Rückblickstag
    expect(latestReviewWeek('2026-11-02', 1)).toEqual({ weekStart: '2026-11-02', from: '2026-10-27', to: '2026-11-02' });
  });

  it('nennt den nächsten Rückblickstag strikt nach heute', () => {
    expect(nextReviewDay('2026-11-07', 0)).toBe('2026-11-08');
    expect(nextReviewDay('2026-11-08', 0)).toBe('2026-11-15');
    expect(nextReviewDay('2026-11-08', 3)).toBe('2026-11-11');
  });
});

describe('Fälligkeit', () => {
  const base = { today: '2026-11-08', enabled: true, weekday: 0 as const };

  it('steht an, solange für die jüngste Woche kein Datensatz existiert', () => {
    expect(dueReviewWeek({ ...base, reviews: [] })?.weekStart).toBe('2026-11-02');
    expect(dueReviewWeek({ ...base, reviews: [{ weekStart: '2026-11-02' }] })).toBeUndefined();
  });

  it('bleibt nach dem Rückblickstag sichtbar, bis die nächste Woche beginnt', () => {
    expect(dueReviewWeek({ ...base, today: '2026-11-12', reviews: [] })?.weekStart).toBe('2026-11-02');
  });

  it('holt keine alten Wochen nach', () => {
    expect(dueReviewWeek({ ...base, today: '2026-11-15', reviews: [{ weekStart: '2026-10-26' }] })?.weekStart).toBe('2026-11-09');
  });

  it('erscheint nicht, wenn der Rückblick ausgeschaltet ist', () => {
    expect(dueReviewWeek({ ...base, enabled: false, reviews: [] })).toBeUndefined();
  });
});

describe('Automatik alle 4 Wochen', () => {
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];

  it('fragt beim 4., 8. … Rückblick', () => {
    expect(asksAutomaticity([], '2026-10-05')).toBe(false);
    expect(asksAutomaticity(weeks.slice(0, 3).map((weekStart) => ({ weekStart })), '2026-10-26')).toBe(true);
    expect(asksAutomaticity(weeks.map((weekStart) => ({ weekStart })), '2026-11-02')).toBe(false);
  });

  it('zählt nur Rückblicke vor dieser Woche', () => {
    const reviews = weeks.map((weekStart) => ({ weekStart }));
    expect(asksAutomaticity(reviews, '2026-10-26')).toBe(true);
  });

  it('bildet den Mittelwert der vier Aussagen', () => {
    expect(automaticityMean([4, 3, 5, 4])).toBe(4);
  });
});

describe('Vorschläge', () => {
  const input = (patch: Partial<SuggestionInput> = {}): SuggestionInput => ({
    habitId: 'h1',
    notTodayCount: 0,
    enabled: true,
    snoozes: {},
    today: '2026-11-08',
    ...patch,
  });

  it('schlägt bei 3× „Heute nicht“ eine kleinere Version vor', () => {
    expect(reviewSuggestions(input({ notTodayCount: 2 }))).toEqual([]);
    expect(reviewSuggestions(input({ notTodayCount: 3 }))).toEqual([{ rule: 'NOT_TODAY', action: 'SMALLER', value: 3 }]);
  });

  it('schlägt bei Leichtigkeit 1–2 eine kleinere Version vor', () => {
    expect(reviewSuggestions(input({ ease: 3 }))).toEqual([]);
    expect(reviewSuggestions(input({ ease: 2 }))).toEqual([{ rule: 'EASE', action: 'SMALLER', value: 2 }]);
  });

  it('schlägt bei „selten“ im geplanten Moment einen anderen Auslöser vor', () => {
    expect(reviewSuggestions(input({ cueConsistency: 'HALF' }))).toEqual([]);
    expect(reviewSuggestions(input({ cueConsistency: 'RARE' }))).toEqual([{ rule: 'CUE', action: 'CHANGE_CUE' }]);
  });

  it('schlägt nie eine Steigerung vor, auch nicht bei hoher Leichtigkeit', () => {
    expect(reviewSuggestions(input({ ease: 5, cueConsistency: 'MOST' }))).toEqual([]);
  });

  it('zeigt nichts, wenn Vorschläge ausgeschaltet sind', () => {
    expect(reviewSuggestions(input({ enabled: false, notTodayCount: 5, ease: 1, cueConsistency: 'RARE' }))).toEqual([]);
  });

  it('lässt ruhende Regeln weg, bis einschließlich des gespeicherten Tags', () => {
    const snoozes = { 'EASE:h1': '2026-11-08' };
    expect(reviewSuggestions(input({ ease: 1, snoozes }))).toEqual([]);
    expect(reviewSuggestions(input({ ease: 1, snoozes, today: '2026-11-09' }))).toHaveLength(1);
    // Andere Regel und anderes Habit sind nicht betroffen
    expect(reviewSuggestions(input({ notTodayCount: 3, snoozes }))).toHaveLength(1);
    expect(reviewSuggestions(input({ habitId: 'h2', ease: 1, snoozes }))).toHaveLength(1);
  });

  it('lässt abgelehnte Vorschläge 28 Tage ruhen und räumt abgelaufene auf', () => {
    const out = snoozesAfterReview({ 'CUE:h1': '2026-11-01', 'EASE:h2': '2026-11-20' }, [{ rule: 'NOT_TODAY', habitId: 'h1' }], '2026-11-08');
    expect(out).toEqual({ 'EASE:h2': '2026-11-20', 'NOT_TODAY:h1': '2026-12-05' });
    // Am 28. Tag ruht er noch, am 29. erscheint er wieder.
    expect(reviewSuggestions(input({ notTodayCount: 3, snoozes: out, today: '2026-12-05' }))).toEqual([]);
    expect(reviewSuggestions(input({ notTodayCount: 3, snoozes: out, today: '2026-12-06' }))).toHaveLength(1);
  });
});

describe('Eingaben bereinigen', () => {
  it('kürzt Texte, verwirft leere Texte und ungültige Skalen', () => {
    const entry = normalizeReviewEntry(
      { habitId: 'h1', helpful: '  Schuhe an der Tür ', difficult: '   ', ease: 7, cueConsistency: 'OFT' as never, decision: 'MORE' as never },
      { automaticity: false },
    );
    expect(entry).toEqual({ habitId: 'h1', helpful: 'Schuhe an der Tür' });
  });

  it('begrenzt lange Texte auf 500 Zeichen', () => {
    const entry = normalizeReviewEntry({ habitId: 'h1', helpful: 'a'.repeat(600) }, { automaticity: false });
    expect(entry.helpful).toHaveLength(500);
  });

  it('speichert Automatik nur vollständig und nur, wenn gefragt', () => {
    const full: WeeklyReviewEntry = { habitId: 'h1', automaticity: [4, 3, 5, 2] };
    expect(normalizeReviewEntry(full, { automaticity: true }).automaticity).toEqual([4, 3, 5, 2]);
    expect(normalizeReviewEntry(full, { automaticity: false }).automaticity).toBeUndefined();
    const partial = { habitId: 'h1', automaticity: [4, 3, 0, 2] } as WeeklyReviewEntry;
    expect(normalizeReviewEntry(partial, { automaticity: true }).automaticity).toBeUndefined();
  });

  it('erkennt leere Einträge', () => {
    expect(isEmptyEntry(normalizeReviewEntry({ habitId: 'h1', helpful: ' ' }, { automaticity: false }))).toBe(true);
    expect(isEmptyEntry({ habitId: 'h1', decision: 'KEEP' })).toBe(false);
  });
});
