import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import {
  addAvoidanceItem,
  createCounterHabit,
  deleteAvoidanceItem,
  moveAvoidanceItem,
  renameAvoidanceItem,
  setAvoidanceItemActive,
} from '../../src/app/counter-habits';
import { clearException, closeDay, loadEveningView, setException } from '../../src/app/evening';
import { completeOnboarding, type OnboardingInput } from '../../src/app/onboarding';
import { loadPlanView } from '../../src/app/plan';
import { changeHabitStatus } from '../../src/app/planning';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

const onboarding: OnboardingInput = {
  goal: { title: 'Mehr Bewegung' },
  habit: {
    actionText: '10 Minuten spazieren',
    minimumText: '2 Minuten vor die Tür',
    cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' },
  },
};

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

beforeEach(async () => {
  // Donnerstag, 5. November 2026
  const clock = fixedClock('2026-11-05T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `evening-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds() };
});
afterEach(() => ctx.repo.close());

async function onboard(counters = true) {
  const r = await completeOnboarding(ctx, { ...onboarding, counters });
  if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
  return r;
}

describe('Gegen-Habits', () => {
  it('Onboarding „Einrichten“ legt beide vordefinierten Gegen-Habits aktiv an, ohne Ausweichliste', async () => {
    await onboard();
    const data = await ctx.repo.loadLive();
    const counters = data.habits.filter((h) => h.kind !== 'BUILD');
    expect(counters.map((h) => [h.kind, h.actionText, h.status, h.schedule.type])).toEqual([
      ['COUNTER_PROCRASTINATION', 'Nicht aufgeschoben', 'ACTIVE', 'DAILY'],
      ['COUNTER_AVOIDANCE', 'Kein Ausweichverhalten', 'ACTIVE', 'DAILY'],
    ]);
    expect(data.avoidanceItems).toEqual([]);
    expect(counters.every((h) => h.minimumText === undefined && h.goalId === undefined)).toBe(true);
  });

  it('„Später“ legt keine Gegen-Habits an', async () => {
    await onboard(false);
    expect((await ctx.repo.loadLive()).habits.filter((h) => h.kind !== 'BUILD')).toEqual([]);
  });

  it('zählen nicht zur Aufbau-Grenze; vordefinierte gibt es nur einmal; Hinweis ab mehr als 5', async () => {
    await onboard();
    expect(await createCounterHabit(ctx, { kind: 'COUNTER_PROCRASTINATION' })).toEqual({ ok: false, error: 'EXISTS' });
    expect(await createCounterHabit(ctx, { kind: 'COUNTER_CUSTOM', actionText: ' ' })).toMatchObject({
      ok: false,
      errors: { actionText: 'REQUIRED' },
    });
    for (const text of ['Kein Alkohol unter der Woche', 'Kein Handy im Bett', 'Keine Süßigkeiten']) {
      expect(await createCounterHabit(ctx, { kind: 'COUNTER_CUSTOM', actionText: text, weight: 2 })).toMatchObject({ ok: true });
    }
    let plan = await loadPlanView(ctx);
    expect(plan.counters.map((c) => c.habit.actionText)).toEqual([
      'Nicht aufgeschoben',
      'Kein Ausweichverhalten',
      'Kein Alkohol unter der Woche',
      'Kein Handy im Bett',
      'Keine Süßigkeiten',
    ]);
    expect(plan.counters.every((c) => c.badge === 'BUILDING')).toBe(true);
    expect(plan.buildingCount).toBe(1);
    expect(plan.hasFreeSlot).toBe(true);
    expect(plan.counterHint).toBe(false);
    expect(plan.predefinedAvailable).toEqual([]);

    await createCounterHabit(ctx, { kind: 'COUNTER_CUSTOM', actionText: 'Kein Zucker im Kaffee' });
    plan = await loadPlanView(ctx);
    expect(plan.counterHint).toBe(true);
  });

  it('archiviert lässt sich ein vordefiniertes Gegen-Habit neu anlegen; pausierte landen in der Gruppe', async () => {
    await onboard();
    const plan = await loadPlanView(ctx);
    const [procrastination, avoidance] = plan.counters.map((c) => c.habit.id);
    await changeHabitStatus(ctx, procrastination!, 'ARCHIVE');
    await changeHabitStatus(ctx, avoidance!, 'PAUSE');
    const after = await loadPlanView(ctx);
    expect(after.counters).toEqual([]);
    expect(after.paused.map((p) => [p.habit.actionText, p.canResume])).toEqual([['Kein Ausweichverhalten', true]]);
    expect(after.archived.map((p) => p.habit.actionText)).toEqual(['Nicht aufgeschoben']);
    expect(after.predefinedAvailable).toEqual(['COUNTER_PROCRASTINATION']);
    expect(await createCounterHabit(ctx, { kind: 'COUNTER_PROCRASTINATION' })).toMatchObject({ ok: true });
  });
});

describe('Ausweichliste', () => {
  it('anlegen, umbenennen, ausblenden, verschieben, löschen', async () => {
    const a = await addAvoidanceItem(ctx, 'Scrollen');
    const b = await addAvoidanceItem(ctx, 'Aufräumen statt Aufgabe');
    expect(await addAvoidanceItem(ctx, 'scrollen')).toEqual({ ok: false, error: 'DUPLICATE' });
    if (!a.ok || !b.ok) throw new Error('Anlegen fehlgeschlagen');

    expect(await renameAvoidanceItem(ctx, a.id, 'Ziellos scrollen')).toEqual({ ok: true, id: a.id });
    await moveAvoidanceItem(ctx, b.id, -1);
    let items = (await ctx.repo.loadLive()).avoidanceItems.sort((x, y) => x.order - y.order);
    expect(items.map((i) => i.label)).toEqual(['Aufräumen statt Aufgabe', 'Ziellos scrollen']);
    expect(await moveAvoidanceItem(ctx, b.id, -1)).toEqual({ ok: false });

    await setAvoidanceItemActive(ctx, a.id, false);
    await deleteAvoidanceItem(ctx, b.id);
    items = (await ctx.repo.loadLive()).avoidanceItems;
    expect(items.map((i) => [i.label, i.active])).toEqual([['Ziellos scrollen', false]]);
    const snapshot = await ctx.repo.loadSnapshot();
    expect(snapshot.avoidanceItems).toContainEqual({ id: b.id, deletedAt: expect.any(String) });
  });
});

describe('Abend-Check-in', () => {
  it('zeigt Gegen-Habits in fester Reihenfolge und offene geplante Habits', async () => {
    const { habitId } = await onboard();
    await createCounterHabit(ctx, { kind: 'COUNTER_CUSTOM', actionText: 'Kein Alkohol unter der Woche' });
    await addAvoidanceItem(ctx, 'Scrollen');
    const view = await loadEveningView(ctx);
    expect(view.day).toBe('2026-11-05');
    expect(view.days).toHaveLength(8);
    expect(view.procrastination?.habit.actionText).toBe('Nicht aufgeschoben');
    expect(view.avoidance?.items.map((i) => i.label)).toEqual(['Scrollen']);
    expect(view.customs.map((c) => c.habit.actionText)).toEqual(['Kein Alkohol unter der Woche']);
    expect(view.open.map((h) => h.id)).toEqual([habitId]);

    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    expect((await loadEveningView(ctx)).open).toEqual([]);
  });

  it('„Tag abschließen“ speichert alles in einem Schritt; Ausweichen ohne Haken heißt „nichts davon“', async () => {
    const { habitId } = await onboard();
    const custom = await createCounterHabit(ctx, { kind: 'COUNTER_CUSTOM', actionText: 'Kein Alkohol unter der Woche' });
    if (!custom.ok) throw new Error();
    let view = await loadEveningView(ctx);

    const r = await closeDay(ctx, {
      day: '2026-11-05',
      mood: 4,
      energy: null,
      answers: [
        { habitId: view.procrastination!.habit.id, outcome: 'PARTIAL' },
        { habitId: custom.habitId, outcome: 'KEPT' },
        { habitId, outcome: 'NOT_DONE' },
      ],
      avoidanceItemIds: [],
    });
    expect(r).toEqual({ ok: true });

    const data = await ctx.repo.loadLive();
    expect(data.dayRecords).toEqual([
      { localDate: '2026-11-05', mood: 4, closedAt: expect.any(String), updatedAt: expect.any(String) },
    ]);
    const byHabit = new Map(data.checkIns.map((c) => [c.habitId, c]));
    expect(byHabit.get(view.procrastination!.habit.id)?.outcome).toBe('PARTIAL');
    expect(byHabit.get(custom.habitId)?.outcome).toBe('KEPT');
    expect(byHabit.get(habitId)?.outcome).toBe('NOT_DONE');
    expect(byHabit.get(view.avoidance!.habit.id)).toMatchObject({ outcome: 'RECORDED', avoidanceItemIds: [] });

    // Korrektur am selben Tag aktualisiert die Einträge statt sie zu verdoppeln.
    const item = await addAvoidanceItem(ctx, 'Scrollen');
    if (!item.ok) throw new Error();
    view = await loadEveningView(ctx);
    await closeDay(ctx, {
      day: '2026-11-05',
      mood: 4,
      energy: 2,
      answers: [{ habitId: view.procrastination!.habit.id, outcome: 'NO' }],
      avoidanceItemIds: [item.id, item.id, 'unbekannt'],
    });
    const after = await ctx.repo.loadLive();
    expect(after.checkIns).toHaveLength(4);
    expect(after.checkIns.find((c) => c.habitId === view.avoidance!.habit.id)?.avoidanceItemIds).toEqual([item.id]);
    expect(after.dayRecords[0]).toMatchObject({ mood: 4, energy: 2 });
  });

  it('rückwirkend bis 7 Tage, nicht früher und nicht in der Zukunft', async () => {
    await onboard();
    ctx.clock.set('2026-11-07T20:00:00+01:00');
    const base = { mood: null, energy: null, answers: [], avoidanceItemIds: [] };
    expect(await closeDay(ctx, { ...base, day: '2026-11-06' })).toEqual({ ok: true });
    expect(await closeDay(ctx, { ...base, day: '2026-10-30' })).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect(await closeDay(ctx, { ...base, day: '2026-11-08' })).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect((await loadEveningView(ctx, '2026-10-01')).day).toBe('2026-11-07');
  });

  it('Gegen-Habits erscheinen erst ab ihrem Start und nicht auf „Heute“', async () => {
    await onboard();
    const view = await loadEveningView(ctx, '2026-11-04');
    expect(view.procrastination).toBeUndefined();
    expect(view.avoidance).toBeUndefined();
    const today = await loadTodayView(ctx);
    expect(today.cards.every((c) => c.habit.kind === 'BUILD')).toBe(true);
  });

  it('Abend-Karte ab 18 Uhr bis zum Abschluss', async () => {
    await onboard();
    expect((await loadTodayView(ctx)).eveningCard).toBe(false);
    ctx.clock.set('2026-11-05T18:00:00+01:00');
    expect((await loadTodayView(ctx)).eveningCard).toBe(true);
    await closeDay(ctx, { day: '2026-11-05', mood: null, energy: null, answers: [], avoidanceItemIds: [] });
    const view = await loadTodayView(ctx);
    expect(view.eveningCard).toBe(false);
    expect(view.dayClosed).toBe(true);
  });
});

describe('Ausnahmetage', () => {
  it('setzen und aufheben, auch nachträglich; Stimmung bleibt dabei erhalten', async () => {
    await onboard();
    expect(await setException(ctx, { day: '2026-10-20', reason: 'SICK' })).toEqual({ ok: true });
    expect(await setException(ctx, { day: '2026-11-06', reason: 'SICK' })).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    await closeDay(ctx, { day: '2026-11-05', mood: 3, energy: null, answers: [], avoidanceItemIds: [] });
    await setException(ctx, { day: '2026-11-05', reason: 'OTHER', note: 'Umzug' });
    let records = (await ctx.repo.loadLive()).dayRecords.sort((a, b) => a.localDate.localeCompare(b.localDate));
    expect(records.map((r) => [r.localDate, r.exception, r.mood])).toEqual([
      ['2026-10-20', { reason: 'SICK' }, undefined],
      ['2026-11-05', { reason: 'OTHER', note: 'Umzug' }, 3],
    ]);

    await clearException(ctx, '2026-10-20');
    await clearException(ctx, '2026-11-05');
    records = (await ctx.repo.loadLive()).dayRecords;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ localDate: '2026-11-05', mood: 3 });
    expect(records[0]!.exception).toBeUndefined();
  });
});
