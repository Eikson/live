import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app/context';
import { chooseHint, markHintShown } from '../../src/app/hint';
import { CHART_DAYS, loadHistoryView } from '../../src/app/history';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import { buildSeed } from '../../src/dev/seed';
import { addDays } from '../../src/domain/local-date';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

const TODAY = '2026-11-07';

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

beforeEach(async () => {
  // Samstag, 7. November 2026, morgens
  const clock = fixedClock('2026-11-07T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `history-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

describe('Verlauf mit Testdaten', () => {
  beforeEach(async () => {
    await ctx.repo.replaceAll(buildSeed(TODAY, 'ruhig'));
  });

  it('zeigt das Niveau erst mit genug Tagen, das Diagramm über 84 Tage und den Vergleich mit vor 6 Monaten', async () => {
    const view = await loadHistoryView(ctx);
    expect(view.hasHabits).toBe(true);
    expect(view.level.sufficient).toBe(true);
    expect(view.level.current.days).toBeGreaterThanOrEqual(14);
    expect(view.level.chart).toHaveLength(CHART_DAYS);
    expect(view.level.chart.at(-1)!.date).toBe(TODAY);
    expect(view.level.comparison.kind).toBe('SIX_MONTHS');
    // Korridor: Boden ≤ Decke, Ø-Score innerhalb von [0, Decke]
    for (const d of view.level.chart) {
      if (!d.avg) continue;
      expect(d.avg.floor).toBeLessThanOrEqual(d.avg.ceiling);
      expect(d.avg.score).toBeLessThanOrEqual(d.avg.ceiling);
    }
  });

  it('Wochentabelle statt Tageswerten: neueste Woche zuerst, Werte nur als Ø', async () => {
    const view = await loadHistoryView(ctx);
    const weeks = view.level.weeks;
    expect(weeks.length).toBeGreaterThan(10);
    expect(weeks[0]!.from > weeks[1]!.from).toBe(true);
    expect(weeks.every((w) => w.avg === undefined || typeof w.avg.value === 'number')).toBe(true);
  });

  it('Markierungen: Ausnahmetage, Wiedereinstieg, Planänderungen; Archiviertes nur als Markierung', async () => {
    const view = await loadHistoryView(ctx);
    const kinds = new Set(view.level.markers.map((m) => m.kind));
    expect(kinds.has('EXCEPTION')).toBe(true);
    expect(kinds.has('PLAN')).toBe(true);
  });

  it('Kalender: pausierte Gewohnheit sichtbar, archivierte nicht; heute ohne Angabe ist „noch offen“', async () => {
    const view = await loadHistoryView(ctx);
    const names = view.month.habits.map((x) => x.habit.actionText);
    expect(names).toContain('Ein Glas Wasser am Morgen');
    expect(names).not.toContain('Dehnen');
    const lesen = view.month.habits.find((x) => x.habit.actionText === '10 Minuten lesen')!;
    const todayIndex = view.month.days.indexOf(TODAY);
    expect(lesen.marks[todayIndex]).toBe('OPEN');
    expect(lesen.status).toBe('INTEGRATED');
    expect(view.month.habits.find((x) => x.habit.actionText === 'Ein Glas Wasser am Morgen')!.status).toBe('PAUSED');
    // Zukunft ist „nicht geplant“
    expect(lesen.marks[todayIndex + 1]).toBe('NOT_PLANNED');
  });

  it('Monatsnavigation ist auf erste Aktivierung und aktuellen Monat begrenzt; Ereignisse benennen „Handlung verkleinert“', async () => {
    const now = await loadHistoryView(ctx);
    expect(now.month.month).toBe('2026-11');
    expect(now.month.next).toBeUndefined();
    const future = await loadHistoryView(ctx, '2027-03');
    expect(future.month.month).toBe('2026-11');
    // Wiedereinstieg liegt 137 Tage nach dem Start (200 Tage vor heute)
    const reentryDay = addDays(addDays(TODAY, -200), 137);
    const month = await loadHistoryView(ctx, reentryDay.slice(0, 7));
    const kinds = month.month.events.filter((e) => e.date === reentryDay).map((e) => e.kind);
    expect(kinds).toContain('REENTERED');
    expect(kinds).toContain('SMALLER');
    const first = await loadHistoryView(ctx, '2020-01');
    expect(first.month.prev).toBeUndefined();
    expect(first.month.events.some((e) => e.kind === 'ACTIVATED')).toBe(true);
  });

  it('Befinden: eigener Durchschnitt und Vergleich, ohne Boden', async () => {
    const view = await loadHistoryView(ctx);
    expect(view.wellbeing.any).toBe(true);
    expect(view.wellbeing.current.sufficient).toBe(true);
    expect(view.wellbeing.current.mean).toBeGreaterThanOrEqual(1);
    expect(view.wellbeing.current.mean).toBeLessThanOrEqual(5);
    expect(view.wellbeing.comparison.kind).toBe('SIX_MONTHS');
  });

  it('gleichmäßiger Verlauf zeigt keine Hinweiskarte', async () => {
    const view = await loadTodayView(ctx);
    expect(view.hint).toBeUndefined();
  });
});

describe('Hinweiskarte', () => {
  beforeEach(async () => {
    await ctx.repo.replaceAll(buildSeed(TODAY, 'muster'));
  });

  it('erscheint bei einem Muster, mit aktiven Aufbau-Habits zur Auswahl (integrierte zuerst)', async () => {
    const view = await loadTodayView(ctx);
    expect(view.hint).toBeDefined();
    expect(view.hint!.habits.map((h) => h.actionText)).toEqual(['10 Minuten lesen', 'Spazieren gehen']);
  });

  it('erscheint höchstens einmal pro 7 Tage: am selben Tag weiter sichtbar, danach erst nach 7 Tagen', async () => {
    await markHintShown(ctx);
    expect((await ctx.repo.getPreferences()).lastWarningCardAt).toBe(TODAY);
    expect((await loadTodayView(ctx)).hint).toBeDefined();
    ctx.clock.set('2026-11-08T09:00:00+01:00');
    expect((await loadTodayView(ctx)).hint).toBeUndefined();
  });

  it('„So lassen“ blendet sie 7 Tage aus und ändert sonst nichts', async () => {
    const before = await ctx.repo.loadLive();
    expect((await chooseHint(ctx, 'KEEP')).ok).toBe(true);
    const after = await ctx.repo.loadLive();
    expect(after.preferences.warningSnoozedUntil).toBe(addDays(TODAY, 7));
    expect(after.habits).toEqual(before.habits);
    expect((await loadTodayView(ctx)).hint).toBeUndefined();
  });

  it('„Pausieren“ pausiert die gewählte Gewohnheit', async () => {
    const view = await loadTodayView(ctx);
    const target = view.hint!.habits[1]!;
    expect((await chooseHint(ctx, 'PAUSE', target.id)).ok).toBe(true);
    const habit = (await ctx.repo.loadLive()).habits.find((h) => h.id === target.id)!;
    expect(habit.status).toBe('PAUSED');
  });

  it('Score und Hinweise werden nie gespeichert', async () => {
    await loadHistoryView(ctx);
    await loadTodayView(ctx);
    const snapshot = await ctx.repo.loadSnapshot();
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/"score"|"floor"|"ceiling"|"integrated"/);
  });
});
