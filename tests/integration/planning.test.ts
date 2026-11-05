import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import { completeOnboarding, type OnboardingInput } from '../../src/app/onboarding';
import { loadHabitWizardContext, loadPlanView } from '../../src/app/plan';
import { activateHabit, changeHabitStatus, createGoal, createHabit, removeCheckIn, type CreateHabitInput } from '../../src/app/planning';
import { loadTodayView } from '../../src/app/today';
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
  ctx = { repo: await IdbRepository.open({ name: `planning-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

async function onboard(): Promise<{ goalId: string; habitId: string }> {
  const r = await completeOnboarding(ctx, onboarding);
  if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
  return r;
}

describe('Ziele und Habits anlegen', () => {
  it('mehrere Ziele mit eigenen Habits', async () => {
    await onboard();
    const goal = await createGoal(ctx, { title: '  Mehr lesen ', why: 'Ruhe am Abend' });
    expect(goal).toMatchObject({ ok: true });
    if (!goal.ok) return;
    const created = await createHabit(ctx, {
      goalId: goal.goalId,
      habit: {
        ...habit,
        actionText: '5 Seiten lesen',
        copingPlans: [{ obstacle: 'Müdigkeit', response: 'eine Seite lesen' }],
        schedule: { type: 'WEEKDAYS', days: [5, 1, 3] },
        weight: 2,
      },
    });
    expect(created).toMatchObject({ ok: true, status: 'ACTIVE' });

    const view = await loadPlanView(ctx);
    expect(view.goals.map((g) => g.goal.title)).toEqual(['Mehr Bewegung', 'Mehr lesen']);
    const reading = view.goals[1]!.habits[0]!.habit;
    expect(reading.schedule).toEqual({ type: 'WEEKDAYS', days: [1, 3, 5] });
    expect(reading.copingPlans).toEqual([{ obstacle: 'Müdigkeit', response: 'eine Seite lesen' }]);
    expect(reading.weight).toBe(2);
    expect(view).toMatchObject({ buildingCount: 2, hasFreeSlot: false });
  });

  it('ungültige Angaben schreiben nichts', async () => {
    const { goalId } = await onboard();
    expect(await createGoal(ctx, { title: ' ' })).toEqual({ ok: false, errors: { title: 'REQUIRED' } });
    const r = await createHabit(ctx, { goalId, habit: { ...habit, schedule: { type: 'WEEKDAYS', days: [] } } });
    expect(r).toEqual({ ok: false, errors: { schedule: 'INVALID' } });
    expect(await createHabit(ctx, { goalId: 'fehlt', habit })).toEqual({ ok: false, error: 'GOAL_NOT_FOUND' });
    const data = await ctx.repo.loadLive();
    expect(data.goals).toHaveLength(1);
    expect(data.habits).toHaveLength(1);
  });

  it('bei voller Aufbau-Grenze entsteht ein Entwurf, der sich später aktivieren lässt', async () => {
    const { goalId, habitId: first } = await onboard();
    await createHabit(ctx, { goalId, habit });
    expect(await loadHabitWizardContext(ctx, goalId)).toMatchObject({ hasFreeSlot: false });
    const third = await createHabit(ctx, { goalId, habit: { ...habit, actionText: 'Dehnen' } });
    expect(third).toMatchObject({ ok: true, status: 'DRAFT' });
    if (!third.ok) return;

    let view = await loadPlanView(ctx);
    expect(view.drafts.map((d) => [d.habit.actionText, d.goalTitle])).toEqual([['Dehnen', 'Mehr Bewegung']]);
    expect(view.goals[0]!.habits).toHaveLength(2);
    expect(await activateHabit(ctx, third.habitId)).toEqual({ ok: false, reason: 'BUILD_LIMIT_REACHED' });

    // Archivieren macht einen Platz frei.
    expect(await changeHabitStatus(ctx, first, 'ARCHIVE')).toEqual({ ok: true });

    expect(await activateHabit(ctx, third.habitId)).toEqual({ ok: true });
    view = await loadPlanView(ctx);
    expect(view.drafts).toEqual([]);
    expect(view.archived.map((a) => a.habit.id)).toEqual([first]);
    expect(view.goals[0]!.habits.map((x) => x.habit.actionText)).toEqual(['10 Minuten spazieren', 'Dehnen']);
    const events = (await ctx.repo.loadLive()).habitEvents.filter((e) => e.habitId === third.habitId);
    expect(events.map((e) => e.type).sort()).toEqual(['ACTIVATED', 'CREATED']);
    expect(await activateHabit(ctx, third.habitId)).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
  });
});

describe('Wochentage und nicht geplante Tage', () => {
  it('zeigt nicht geplante Habits mit dem nächsten Termin und erlaubt „Trotzdem gemacht“', async () => {
    const goal = await createGoal(ctx, { title: 'Mehr Bewegung' });
    if (!goal.ok) return;
    // Montag und Mittwoch; heute ist Donnerstag.
    const r = await createHabit(ctx, { goalId: goal.goalId, habit: { ...habit, schedule: { type: 'WEEKDAYS', days: [1, 3] } } });
    if (!r.ok) return;

    let card = (await loadTodayView(ctx)).cards[0]!;
    expect(card).toMatchObject({ planned: false, nextDate: '2026-11-09' });

    const done = await recordCheckIn(ctx, { habitId: r.habitId, localDate: '2026-11-05', outcome: 'DONE' });
    expect(done).toMatchObject({ ok: true, checkIn: { unplanned: true, outcome: 'DONE' } });

    // Zurücknehmen: nur eine Löschmarkierung bleibt, ein neuer Eintrag ist wieder möglich.
    expect(await removeCheckIn(ctx, { habitId: r.habitId, localDate: '2026-11-05' })).toEqual({ ok: true });
    card = (await loadTodayView(ctx)).cards[0]!;
    expect(card.checkIn).toBeUndefined();
    const snapshot = await ctx.repo.loadSnapshot();
    expect(snapshot.checkIns).toEqual([{ id: expect.any(String), deletedAt: '2026-11-05T08:00:00.000Z' }]);
    expect(await recordCheckIn(ctx, { habitId: r.habitId, localDate: '2026-11-05', outcome: 'DONE' })).toMatchObject({ ok: true });
  });

  it('geplante Karten stehen vor nicht geplanten', async () => {
    const { goalId } = await onboard();
    await createHabit(ctx, { goalId, habit: { ...habit, actionText: 'Montags', schedule: { type: 'WEEKDAYS', days: [1] } } });
    const view = await loadTodayView(ctx);
    expect(view.cards.map((c) => [c.habit.actionText, c.planned])).toEqual([
      ['10 Minuten spazieren', true],
      ['Montags', false],
    ]);
  });
});

describe('Nachtragen', () => {
  it('bis genau 7 Tage zurück; ältere Tage fallen auf heute zurück', async () => {
    ctx.clock.set('2026-10-20T09:00:00+02:00');
    const { habitId } = await onboard();
    ctx.clock.set('2026-11-05T09:00:00+01:00');

    const view = await loadTodayView(ctx, '2026-10-29');
    expect(view.day).toBe('2026-10-29');
    expect(view.days).toHaveLength(8);
    expect(view.days[0]).toBe('2026-11-05');
    expect(view.days.at(-1)).toBe('2026-10-29');
    expect(view.cards[0]).toMatchObject({ planned: true });

    expect((await loadTodayView(ctx, '2026-10-28')).day).toBe('2026-11-05');
    expect((await loadTodayView(ctx, '2026-11-06')).day).toBe('2026-11-05');

    const r = await recordCheckIn(ctx, { habitId, localDate: '2026-10-29', outcome: 'NOT_DONE' });
    expect(r).toMatchObject({ ok: true, checkIn: { localDate: '2026-10-29', unplanned: false } });
    expect((await loadTodayView(ctx, '2026-10-29')).cards[0]!.checkIn?.outcome).toBe('NOT_DONE');
    expect(await removeCheckIn(ctx, { habitId, localDate: '2026-10-28' })).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
  });

  it('vor der Aktivierung gibt es an einem Tag keine Karte', async () => {
    await onboard();
    expect((await loadTodayView(ctx, '2026-11-04')).cards).toEqual([]);
  });
});
