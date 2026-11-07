import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import { createCounterHabit } from '../../src/app/counter-habits';
import { loadHistoryView } from '../../src/app/history';
import { completeOnboarding } from '../../src/app/onboarding';
import { deleteHabit } from '../../src/app/planning';
import { updatePreferences } from '../../src/app/preferences';
import { completeReview, loadReviewView, skipReview } from '../../src/app/review';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

// Donnerstag, 5. November 2026; Rückblickstag Sonntag, 8. November (Woche ab Montag, 2. November)
const WEEK = '2026-11-02';
const SUNDAY = '2026-11-08T10:00:00+01:00';

beforeEach(async () => {
  const clock = fixedClock('2026-11-05T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `review-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

async function onboard(): Promise<string> {
  const r = await completeOnboarding(ctx, {
    goal: { title: 'Mehr Bewegung' },
    habit: { actionText: '10 Minuten spazieren', minimumText: '2 Minuten vor die Tür', cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' } },
  });
  if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
  return r.habitId;
}

describe('Fälligkeit und Karte auf „Heute“', () => {
  it('erscheint ab dem Rückblickstag, nicht davor', async () => {
    await onboard();
    expect((await loadTodayView(ctx)).review).toBeUndefined();
    ctx.clock.set(SUNDAY);
    expect((await loadTodayView(ctx)).review).toEqual({ weekStart: WEEK, from: '2026-11-02', to: '2026-11-08' });
    expect((await loadReviewView(ctx)).state).toBe('DUE');
  });

  it('erscheint nicht für ein Habit, das erst am Rückblickstag startet', async () => {
    ctx.clock.set(SUNDAY);
    await onboard();
    expect((await loadTodayView(ctx)).review).toBeUndefined();
    expect((await loadReviewView(ctx)).state).toBe('NONE');
  });

  it('erscheint nicht, wenn der Rückblick ausgeschaltet ist, und folgt dem gewählten Wochentag', async () => {
    await onboard();
    await updatePreferences(ctx, { reviewEnabled: false });
    ctx.clock.set(SUNDAY);
    expect((await loadTodayView(ctx)).review).toBeUndefined();
    expect((await loadReviewView(ctx)).state).toBe('OFF');

    // Samstag als Rückblickstag: Am 7. November steht die Woche bis Samstag an.
    await updatePreferences(ctx, { reviewEnabled: true, reviewWeekday: 6 });
    ctx.clock.set('2026-11-07T10:00:00+01:00');
    expect((await loadTodayView(ctx)).review).toEqual({ weekStart: WEEK, from: '2026-11-01', to: '2026-11-07' });
  });

  it('teilt Habits im Aufbau und Gegen-Habits auf', async () => {
    const habitId = await onboard();
    const counter = await createCounterHabit(ctx, { kind: 'COUNTER_PROCRASTINATION' });
    if (!counter.ok) throw new Error('Gegen-Habit fehlt');
    ctx.clock.set(SUNDAY);
    const view = await loadReviewView(ctx);
    expect(view.building.map((b) => b.habit.id)).toEqual([habitId]);
    expect(view.compact.map((h) => h.id)).toEqual([counter.habitId]);
    expect(view.automaticity).toBe(false);
  });
});

describe('Abschließen', () => {
  it('speichert nur ausgefüllte Angaben und lässt die Karte verschwinden', async () => {
    const habitId = await onboard();
    ctx.clock.set(SUNDAY);
    const result = await completeReview(ctx, WEEK, [
      { habitId, helpful: '  Schuhe an der Tür  ', difficult: '', ease: 4, cueConsistency: 'MOST', decision: 'KEEP' },
      { habitId: 'unbekannt', ease: 3 },
    ]);
    expect(result).toEqual({ ok: true, paused: [] });
    const { weeklyReviews } = await ctx.repo.loadLive();
    expect(weeklyReviews).toHaveLength(1);
    expect(weeklyReviews[0]).toMatchObject({
      weekStart: WEEK,
      status: 'COMPLETED',
      entries: [{ habitId, helpful: 'Schuhe an der Tür', ease: 4, cueConsistency: 'MOST', decision: 'KEEP' }],
    });
    expect((await loadTodayView(ctx)).review).toBeUndefined();
    expect((await loadReviewView(ctx)).state).toBe('COMPLETED');
    expect(await completeReview(ctx, WEEK, [])).toEqual({ ok: false, reason: 'NOT_DUE' });
  });

  it('pausiert ein Habit in derselben Transaktion', async () => {
    const habitId = await onboard();
    ctx.clock.set(SUNDAY);
    const result = await completeReview(ctx, WEEK, [{ habitId, decision: 'PAUSE' }]);
    expect(result).toEqual({ ok: true, paused: [habitId] });
    const data = await ctx.repo.loadLive();
    expect(data.habits[0]!.status).toBe('PAUSED');
    expect(data.habitEvents.filter((e) => e.type === 'PAUSED')).toHaveLength(1);
  });

  it('lässt nicht gewählte Vorschläge 28 Tage ruhen, gewählte nicht', async () => {
    const habitId = await onboard();
    ctx.clock.set('2026-11-07T20:00:00+01:00');
    for (const localDate of ['2026-11-05', '2026-11-06', '2026-11-07']) {
      expect(await recordCheckIn(ctx, { habitId, localDate, outcome: 'NOT_DONE' })).toMatchObject({ ok: true });
    }
    ctx.clock.set(SUNDAY);
    const view = await loadReviewView(ctx);
    expect(view.building[0]!.notTodayCount).toBe(3);

    // Leichtigkeit 2 und „Heute nicht“ schlagen „kleiner“ vor, „selten“ einen anderen Auslöser.
    // Gewählt wird „kleiner“: nur der Auslöser-Vorschlag ruht.
    await completeReview(ctx, WEEK, [{ habitId, ease: 2, cueConsistency: 'RARE', decision: 'SMALLER' }]);
    const prefs = (await ctx.repo.loadLive()).preferences;
    expect(prefs.suggestionSnoozes).toEqual({ [`CUE:${habitId}`]: '2026-12-05' });
  });

  it('lässt ohne Entscheidung alle gezeigten Vorschläge ruhen', async () => {
    const habitId = await onboard();
    ctx.clock.set(SUNDAY);
    await completeReview(ctx, WEEK, [{ habitId, ease: 1 }]);
    expect((await ctx.repo.loadLive()).preferences.suggestionSnoozes).toEqual({ [`EASE:${habitId}`]: '2026-12-05' });
  });

  it('lässt keine Vorschläge ruhen, wenn Vorschläge ausgeschaltet sind', async () => {
    const habitId = await onboard();
    await updatePreferences(ctx, { suggestionsEnabled: false });
    ctx.clock.set(SUNDAY);
    await completeReview(ctx, WEEK, [{ habitId, ease: 1 }]);
    expect((await ctx.repo.loadLive()).preferences.suggestionSnoozes).toEqual({});
  });
});

describe('Überspringen', () => {
  it('speichert einen leeren Datensatz, lässt nichts ruhen und zählt für die Automatik mit', async () => {
    await onboard();
    ctx.clock.set(SUNDAY);
    expect(await skipReview(ctx, WEEK)).toEqual({ ok: true, paused: [] });
    const data = await ctx.repo.loadLive();
    expect(data.weeklyReviews[0]).toMatchObject({ weekStart: WEEK, status: 'SKIPPED', entries: [] });
    expect(data.preferences.suggestionSnoozes).toEqual({});
    expect((await loadTodayView(ctx)).review).toBeUndefined();
    expect(await skipReview(ctx, WEEK)).toEqual({ ok: false, reason: 'NOT_DUE' });
  });

  it('fragt beim 4. Rückblick nach der Automatik', async () => {
    const habitId = await onboard();
    for (const sunday of ['2026-11-08', '2026-11-15', '2026-11-22']) {
      ctx.clock.set(`${sunday}T10:00:00+01:00`);
      const view = await loadReviewView(ctx);
      expect(view.automaticity).toBe(false);
      await skipReview(ctx, view.week.weekStart);
    }
    ctx.clock.set('2026-11-29T10:00:00+01:00');
    const view = await loadReviewView(ctx);
    expect(view.automaticity).toBe(true);
    await completeReview(ctx, view.week.weekStart, [{ habitId, automaticity: [4, 3, 5, 4] }]);
    const history = await loadHistoryView(ctx, '2026-11');
    expect(history.month.habits[0]!.reviews).toEqual([{ weekStart: '2026-11-23', automaticity: 4 }]);
  });
});

describe('Löschen', () => {
  it('entfernt die Angaben eines gelöschten Habits aus den Rückblicken', async () => {
    const habitId = await onboard();
    ctx.clock.set(SUNDAY);
    await completeReview(ctx, WEEK, [{ habitId, ease: 4 }]);
    await deleteHabit(ctx, habitId);
    const { weeklyReviews } = await ctx.repo.loadLive();
    expect(weeklyReviews[0]!.entries).toEqual([]);
  });
});
