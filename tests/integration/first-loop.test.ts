import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import { completeOnboarding, type OnboardingInput } from '../../src/app/onboarding';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

const input: OnboardingInput = {
  goal: { title: 'Mehr Bewegung', why: 'Ich will mich wacher fühlen.' },
  habit: {
    actionText: '10 Minuten spazieren',
    minimumText: '2 Minuten vor die Tür',
    cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' },
    intention: { ifText: 'nach dem Mittagessen', thenText: '10 Minuten spazieren' },
    weight: 2,
  },
};

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

beforeEach(async () => {
  const clock = fixedClock('2026-11-05T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `loop-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

describe('erster Start', () => {
  it('legt Ziel, aktives Habit, Protokoll und Abschluss in einem Schritt an', async () => {
    const result = await completeOnboarding(ctx, input);
    expect(result).toMatchObject({ ok: true, status: 'ACTIVE' });

    const data = await ctx.repo.loadLive();
    expect(data.goals).toEqual([expect.objectContaining({ title: 'Mehr Bewegung', why: 'Ich will mich wacher fühlen.' })]);
    expect(data.habits[0]).toMatchObject({ status: 'ACTIVE', activatedOn: '2026-11-05', weight: 2, kind: 'BUILD' });
    expect(data.habitEvents.map((e) => e.type)).toEqual(['CREATED', 'ACTIVATED']);
    expect(data.preferences.onboardingCompletedAt).toBe('2026-11-05T08:00:00.000Z');
  });

  it('schreibt bei ungültigen Angaben nichts', async () => {
    const result = await completeOnboarding(ctx, { goal: { title: ' ' }, habit: { ...input.habit, minimumText: '' } });
    expect(result).toEqual({ ok: false, goalErrors: { title: 'REQUIRED' }, habitErrors: { minimumText: 'REQUIRED' } });
    const data = await ctx.repo.loadLive();
    expect(data.goals).toEqual([]);
    expect(data.preferences.onboardingCompletedAt).toBeUndefined();
  });

  it('ein drittes Habit im Aufbau bleibt Entwurf', async () => {
    await completeOnboarding(ctx, input);
    await completeOnboarding(ctx, input);
    const third = await completeOnboarding(ctx, input);
    expect(third).toMatchObject({ ok: true, status: 'DRAFT' });
    expect((await loadTodayView(ctx)).cards).toHaveLength(2);
  });
});

describe('Check-in', () => {
  async function onboard() {
    const r = await completeOnboarding(ctx, input);
    if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
    return r.habitId;
  }

  it('Heute zeigt die Karte, nach dem Check-in mit Ergebnis', async () => {
    const habitId = await onboard();
    let view = await loadTodayView(ctx);
    expect(view.today).toBe('2026-11-05');
    expect(view.cards).toHaveLength(1);
    expect(view.cards[0]?.checkIn).toBeUndefined();

    const r = await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    expect(r).toMatchObject({ ok: true, checkIn: { outcome: 'DONE', minimal: false, unplanned: false } });
    view = await loadTodayView(ctx);
    expect(view.cards[0]?.checkIn?.outcome).toBe('DONE');
  });

  it('Korrektur, Minimalversion und Notiz ändern denselben Eintrag', async () => {
    const habitId = await onboard();
    const day = '2026-11-05';
    const first = await recordCheckIn(ctx, { habitId, localDate: day, outcome: 'DONE' });
    await recordCheckIn(ctx, { habitId, localDate: day, minimal: true });
    await recordCheckIn(ctx, { habitId, localDate: day, note: 'Kurz vor dem Regen' });
    ctx.clock.set('2026-11-05T20:00:00+01:00');
    const corrected = await recordCheckIn(ctx, { habitId, localDate: day, outcome: 'NOT_DONE' });

    const all = (await ctx.repo.loadLive()).checkIns;
    expect(all).toHaveLength(1);
    expect(corrected.ok && first.ok && corrected.checkIn.id === first.checkIn.id).toBe(true);
    expect(all[0]).toMatchObject({ outcome: 'NOT_DONE', minimal: false, note: 'Kurz vor dem Regen' });
  });

  it('ein Doppeltipp erzeugt nur einen Eintrag', async () => {
    const habitId = await onboard();
    await Promise.all([
      recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' }),
      recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' }),
    ]);
    expect((await ctx.repo.loadLive()).checkIns).toHaveLength(1);
  });

  it('ohne Ergebnis lässt sich keine Notiz anlegen', async () => {
    const habitId = await onboard();
    expect(await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', note: 'x' })).toEqual({
      ok: false,
      error: 'NO_OUTCOME',
    });
    expect((await ctx.repo.loadLive()).checkIns).toEqual([]);
  });

  it('vor der Aktivierung und für unbekannte Habits gibt es keinen Check-in', async () => {
    const habitId = await onboard();
    expect(await recordCheckIn(ctx, { habitId, localDate: '2026-11-04', outcome: 'DONE' })).toEqual({
      ok: false,
      error: 'NOT_ACTIVE',
    });
    expect(await recordCheckIn(ctx, { habitId: 'gibt-es-nicht', localDate: '2026-11-05', outcome: 'DONE' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('rückwirkend bis 7 Tage, danach nicht mehr', async () => {
    const habitId = await onboard();
    ctx.clock.set('2026-11-12T09:00:00+01:00');
    expect((await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' })).ok).toBe(true);
    ctx.clock.set('2026-11-13T09:00:00+01:00');
    expect(await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'NOT_DONE' })).toEqual({
      ok: false,
      error: 'OUT_OF_RANGE',
    });
  });

  it('„Heute nicht“ erzeugt keine weiteren Datensätze', async () => {
    const habitId = await onboard();
    const before = await ctx.repo.loadSnapshot();
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'NOT_DONE' });
    const after = await ctx.repo.loadSnapshot();
    expect(after.checkIns).toHaveLength(1);
    expect(after.habitEvents).toEqual(before.habitEvents);
    expect(after.habits).toEqual(before.habits);
    expect(after.dayRecords).toEqual([]);
  });
});
