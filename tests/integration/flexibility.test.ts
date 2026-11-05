import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import { completeOnboarding, type OnboardingInput } from '../../src/app/onboarding';
import { loadPlanView } from '../../src/app/plan';
import {
  activateHabit,
  changeHabitStatus,
  createGoal,
  createHabit,
  deleteGoal,
  deleteHabit,
  reenter,
  updateGoal,
  updateHabit,
  type CreateHabitInput,
} from '../../src/app/planning';
import { loadTodayView } from '../../src/app/today';
import { buildTimeline } from '../../src/domain/habit-history';
import { IdbRepository } from '../../src/data/idb-repository';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

const habit: CreateHabitInput['habit'] = {
  actionText: '10 Minuten spazieren',
  minimumText: '2 Minuten vor die Tür',
  cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' },
};
const onboarding: OnboardingInput = { goal: { title: 'Mehr Bewegung' }, habit };

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

beforeEach(async () => {
  // Donnerstag, 5. November 2026
  const clock = fixedClock('2026-11-05T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `flex-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

async function onboard(): Promise<{ goalId: string; habitId: string }> {
  const r = await completeOnboarding(ctx, onboarding);
  if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
  return r;
}

async function addHabit(goalId: string, actionText: string): Promise<string> {
  const r = await createHabit(ctx, { goalId, habit: { ...habit, actionText } });
  if (!r.ok) throw new Error('Habit fehlgeschlagen');
  return r.habitId;
}

describe('Bearbeiten', () => {
  it('Änderungen landen im Protokoll, Angaben bleiben, Rhythmus gilt ab heute', async () => {
    const { habitId } = await onboard();
    ctx.clock.set('2026-11-07T09:00:00+01:00'); // Samstag
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-06', outcome: 'DONE' });
    const before = (await ctx.repo.loadLive()).checkIns;

    const r = await updateHabit(ctx, habitId, {
      ...habit,
      minimumText: 'Schuhe anziehen',
      schedule: { type: 'WEEKDAYS', days: [1] },
      weight: 2,
    });
    expect(r).toEqual({ ok: true, changed: true });

    const data = await ctx.repo.loadLive();
    expect(data.checkIns).toEqual(before);
    const h = data.habits[0]!;
    expect(h.minimumText).toBe('Schuhe anziehen');
    const events = data.habitEvents.filter((e) => e.habitId === habitId);
    expect(events.filter((e) => e.localDate === '2026-11-07').map((e) => e.type)).toEqual([
      'EDITED',
      'SCHEDULE_CHANGED',
      'WEIGHT_CHANGED',
    ]);
    const t = buildTimeline(h, events);
    expect(t.isPlannedOn('2026-11-06')).toBe(true); // Freitag, damals täglich
    expect(t.isPlannedOn('2026-11-07')).toBe(false);
    expect(t.weightOn('2026-11-06')).toBe(1);
    expect(t.weightOn('2026-11-07')).toBe(2);
  });

  it('ohne Änderung wird nichts geschrieben; ungültige Angaben ebenfalls nicht', async () => {
    const { habitId } = await onboard();
    const count = (await ctx.repo.loadLive()).habitEvents.length;
    expect(await updateHabit(ctx, habitId, habit)).toEqual({ ok: true, changed: false });
    expect(await updateHabit(ctx, habitId, { ...habit, actionText: ' ' })).toEqual({
      ok: false,
      errors: { actionText: 'REQUIRED' },
    });
    expect((await ctx.repo.loadLive()).habitEvents).toHaveLength(count);
    expect(await updateHabit(ctx, 'fehlt', habit)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('archivierte Habits lassen sich nicht mehr bearbeiten', async () => {
    const { habitId } = await onboard();
    await changeHabitStatus(ctx, habitId, 'ARCHIVE');
    expect(await updateHabit(ctx, habitId, { ...habit, actionText: 'anders' })).toEqual({ ok: false, error: 'ARCHIVED' });
  });

  it('Ziel bearbeiten', async () => {
    const { goalId } = await onboard();
    expect(await updateGoal(ctx, goalId, { title: 'Mehr draußen', why: 'Frische Luft' })).toEqual({ ok: true });
    expect(await updateGoal(ctx, goalId, { title: '' })).toEqual({ ok: false, errors: { title: 'REQUIRED' } });
    const goal = (await ctx.repo.loadLive()).goals[0]!;
    expect(goal).toMatchObject({ title: 'Mehr draußen', why: 'Frische Luft' });
    expect(await updateGoal(ctx, goalId, { title: 'Mehr draußen' })).toEqual({ ok: true });
    expect((await ctx.repo.loadLive()).goals[0]!.why).toBeUndefined();
  });
});

describe('Pausieren, Fortsetzen, Archivieren', () => {
  it('Pausieren macht einen Platz frei; Fortsetzen braucht wieder einen', async () => {
    const { goalId, habitId: first } = await onboard();
    const second = await addHabit(goalId, '5 Seiten lesen');
    const third = await addHabit(goalId, 'Wasser trinken');
    expect((await loadPlanView(ctx)).drafts.map((h) => h.habit.id)).toEqual([third]);

    ctx.clock.set('2026-11-05T10:00:00+01:00');
    expect(await changeHabitStatus(ctx, first, 'PAUSE')).toEqual({ ok: true });
    expect(await changeHabitStatus(ctx, first, 'PAUSE')).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
    let view = await loadPlanView(ctx);
    expect(view.paused.map((p) => p.habit.id)).toEqual([first]);
    expect(view.paused[0]!.canResume).toBe(true);
    expect((await loadTodayView(ctx)).cards.map((c) => c.habit.id)).toEqual([second]);

    // Der Entwurf nimmt den freien Platz ein.
    expect(await activateHabit(ctx, third)).toEqual({ ok: true });
    view = await loadPlanView(ctx);
    expect(view.paused[0]!.canResume).toBe(false);
    expect(await changeHabitStatus(ctx, first, 'RESUME')).toEqual({ ok: false, reason: 'BUILD_LIMIT_REACHED' });

    expect(await changeHabitStatus(ctx, third, 'ARCHIVE')).toEqual({ ok: true });
    expect(await changeHabitStatus(ctx, first, 'RESUME')).toEqual({ ok: true });
    view = await loadPlanView(ctx);
    expect(view.archived.map((p) => p.habit.id)).toEqual([third]);
    expect(await changeHabitStatus(ctx, third, 'RESUME')).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
  });

  it('pausierte Tage zählen nicht als geplant, frühere Angaben bleiben', async () => {
    const { habitId } = await onboard();
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    ctx.clock.set('2026-11-06T09:00:00+01:00');
    await changeHabitStatus(ctx, habitId, 'PAUSE');
    const data = await ctx.repo.loadLive();
    const t = buildTimeline(data.habits[0]!, data.habitEvents);
    expect(t.isActiveOn('2026-11-05')).toBe(true);
    expect(t.isActiveOn('2026-11-06')).toBe(false);
    expect(data.checkIns).toHaveLength(1);
  });

  it('Pausieren und Fortsetzen in derselben Millisekunde bleiben in der richtigen Reihenfolge', async () => {
    const { habitId } = await onboard();
    for (let i = 0; i < 5; i++) {
      await changeHabitStatus(ctx, habitId, 'PAUSE');
      await changeHabitStatus(ctx, habitId, 'RESUME');
    }
    const data = await ctx.repo.loadLive();
    const stamps = data.habitEvents.filter((e) => e.type === 'PAUSED' || e.type === 'RESUMED').map((e) => e.at);
    expect(stamps).toHaveLength(10);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(buildTimeline(data.habits[0]!, data.habitEvents).isActiveOn('2026-11-05')).toBe(true);
    expect((await loadTodayView(ctx)).cards.map((c) => c.habit.id)).toEqual([habitId]);
  });
});

describe('Löschen', () => {
  it('ein Habit hinterlässt nur Löschmarkierungen, keine verwaisten Daten', async () => {
    const { goalId, habitId } = await onboard();
    const other = await addHabit(goalId, '5 Seiten lesen');
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    await recordCheckIn(ctx, { habitId: other, localDate: '2026-11-05', outcome: 'DONE' });
    const at = ctx.clock.now().toISOString();
    await ctx.repo.commit({
      weeklyReviews: [
        {
          id: 'r1',
          weekStart: '2026-11-02',
          status: 'COMPLETED',
          entries: [{ habitId, helpful: 'Sonne' }, { habitId: other, ease: 3 }],
          createdAt: at,
          updatedAt: at,
        },
      ],
    });

    expect(await deleteHabit(ctx, habitId)).toEqual({ ok: true });
    expect(await deleteHabit(ctx, habitId)).toEqual({ ok: false });

    const snap = await ctx.repo.loadSnapshot();
    expect(snap.habits.find((h) => h.id === habitId)).toEqual({ id: habitId, deletedAt: at });
    expect(snap.habitEvents.some((e) => e.habitId === habitId)).toBe(false);
    for (const c of snap.checkIns) {
      if (!('deletedAt' in c)) expect(c.habitId).toBe(other);
    }
    expect(snap.checkIns.filter((c) => 'deletedAt' in c)).toHaveLength(1);
    expect(snap.weeklyReviews[0]!.entries).toEqual([{ habitId: other, ease: 3 }]);
    expect(JSON.stringify(snap)).not.toContain('Sonne');

    const live = await ctx.repo.loadLive();
    expect(live.habits.map((h) => h.id)).toEqual([other]);
    expect(live.checkIns.map((c) => c.habitId)).toEqual([other]);
  });

  it('ein Ziel nimmt seine Habits mit, andere Ziele bleiben', async () => {
    const { goalId } = await onboard();
    const draftOf = await addHabit(goalId, '5 Seiten lesen');
    await changeHabitStatus(ctx, draftOf, 'PAUSE');
    const second = await createGoal(ctx, { title: 'Mehr lesen' });
    if (!second.ok) throw new Error();
    const kept = await addHabit(second.goalId, 'Ein Kapitel');

    expect(await deleteGoal(ctx, goalId)).toEqual({ ok: true });
    const live = await ctx.repo.loadLive();
    expect(live.goals.map((g) => g.id)).toEqual([second.goalId]);
    expect(live.habits.map((h) => h.id)).toEqual([kept]);
    expect(live.habitEvents.every((e) => e.habitId === kept)).toBe(true);
    const snap = await ctx.repo.loadSnapshot();
    expect(snap.goals.filter((g) => 'deletedAt' in g)).toHaveLength(1);
  });
});

describe('Wiedereinstieg', () => {
  it('erscheint nach 5 Tagen ohne Angabe und verschwindet nach der Wahl', async () => {
    const { habitId } = await onboard();
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    ctx.clock.set('2026-11-09T09:00:00+01:00');
    expect((await loadTodayView(ctx)).reentry).toBeUndefined();

    ctx.clock.set('2026-11-10T09:00:00+01:00');
    const view = await loadTodayView(ctx);
    expect(view.reentry).toMatchObject({ since: '2026-11-05', habits: [{ id: habitId }] });
    // Beim Nachtragen erscheint die Karte nicht.
    expect((await loadTodayView(ctx, '2026-11-08')).reentry).toBeUndefined();

    expect(await reenter(ctx, { habitIds: [habitId], choice: 'CONTINUE' })).toEqual({ ok: true });
    expect((await loadTodayView(ctx)).reentry).toBeUndefined();
    const ev = (await ctx.repo.loadLive()).habitEvents.filter((e) => e.type === 'REENTERED');
    expect(ev).toMatchObject([{ habitId, localDate: '2026-11-10', after: 'CONTINUE' }]);
  });

  it('Pausieren pausiert nur das gewählte Habit; die anderen machen weiter', async () => {
    const { goalId, habitId: first } = await onboard();
    const second = await addHabit(goalId, '5 Seiten lesen');
    ctx.clock.set('2026-11-12T09:00:00+01:00');
    const view = await loadTodayView(ctx);
    expect(view.reentry?.habits.map((h) => h.id)).toEqual([first, second]);

    expect(await reenter(ctx, { habitIds: [first, second], choice: 'PAUSE', targetId: second })).toEqual({ ok: true });
    const data = await ctx.repo.loadLive();
    expect(data.habits.find((h) => h.id === second)!.status).toBe('PAUSED');
    expect(data.habits.find((h) => h.id === first)!.status).toBe('ACTIVE');
    const reentered = data.habitEvents.filter((e) => e.type === 'REENTERED').map((e) => [e.habitId, e.after]);
    expect(reentered).toEqual([
      [first, 'CONTINUE'],
      [second, 'PAUSE'],
    ]);
    expect((await loadTodayView(ctx)).reentry).toBeUndefined();
  });

  it('eine Angabe zum Befinden oder ein Ausnahmetag zählt als Angabe', async () => {
    await onboard();
    ctx.clock.set('2026-11-12T09:00:00+01:00');
    await ctx.repo.commit({ dayRecords: [{ localDate: '2026-11-10', exception: { reason: 'SICK' }, updatedAt: ctx.clock.now().toISOString() }] });
    expect((await loadTodayView(ctx)).reentry).toBeUndefined();
  });
});
