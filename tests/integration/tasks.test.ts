import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, importMerge } from '../../src/app/backup';
import type { AppContext } from '../../src/app/context';
import { loadHistoryView } from '../../src/app/history';
import { completeOnboarding } from '../../src/app/onboarding';
import { loadPlanView } from '../../src/app/plan';
import { loadReviewView } from '../../src/app/review';
import {
  answerLateStart,
  createTask,
  deferTask,
  deleteTask,
  dropTask,
  finishTask,
  loadTaskForm,
  markReviewDone,
  startTask,
  updateTask,
} from '../../src/app/tasks';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import { parseBackupText } from '../../src/domain/backup-schema';
import type { TaskInput } from '../../src/domain/task';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

let dbSeq = 0;
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

beforeEach(async () => {
  // Montag, 9. November 2026
  const clock = fixedClock('2026-11-09T09:00:00+01:00');
  ctx = { repo: await IdbRepository.open({ name: `tasks-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds('t') };
});
afterEach(() => ctx.repo.close());

const deck: TaskInput = {
  title: 'Steering-Deck',
  deadline: '2026-11-13',
  plannedStart: '2026-11-10',
  firstStep: 'Fünf Überschriften für die Storyline',
  estimateMinutes: '240',
  reviewOn: '2026-11-12',
};

async function create(input: Partial<TaskInput> = {}): Promise<string> {
  const r = await createTask(ctx, { ...deck, ...input });
  if (!r.ok) throw new Error(`Anlegen fehlgeschlagen: ${JSON.stringify(r)}`);
  return r.taskId;
}

const day = (iso: string) => ctx.clock.set(`${iso}T09:00:00+01:00`);
const stored = async (id: string) => (await ctx.repo.loadLive()).tasks.find((t) => t.id === id)!;

describe('Vorhaben anlegen und auf „Heute“ sehen', () => {
  it('erscheint erst ab dem geplanten Start auf „Heute“, im Plan sofort', async () => {
    const id = await create();
    expect((await loadTodayView(ctx)).tasks).toEqual([]);
    const plan = await loadPlanView(ctx);
    expect(plan.tasks.open.map((i) => [i.task.id, i.phase])).toEqual([[id, 'UPCOMING']]);

    day('2026-11-10');
    const today = await loadTodayView(ctx);
    expect(today.tasks).toMatchObject([{ phase: 'DUE', waitingDays: 0, daysToDeadline: 3, reviewOpen: true }]);
    // Beim Nachtragen eines früheren Tages stehen keine Vorhaben da.
    expect((await loadTodayView(ctx, '2026-11-09')).tasks).toEqual([]);
  });

  it('meldet Feldfehler und speichert dann nichts', async () => {
    const r = await createTask(ctx, { ...deck, title: '', plannedStart: '2026-11-14' });
    expect(r).toEqual({ ok: false, errors: { title: 'REQUIRED', plannedStart: 'INVALID' } });
    expect((await ctx.repo.loadLive()).tasks).toEqual([]);
  });

  it('lässt höchstens drei offene Vorhaben zu; ein abgeschlossenes macht Platz', async () => {
    const first = await create({ title: 'A', plannedStart: '2026-11-09' });
    await create({ title: 'B' });
    await create({ title: 'C' });
    expect(await createTask(ctx, { ...deck, title: 'D' })).toEqual({ ok: false, error: 'LIMIT_REACHED' });
    expect((await loadTaskForm(ctx))?.canAdd).toBe(false);
    expect((await loadPlanView(ctx)).tasks.canAdd).toBe(false);

    expect(await finishTask(ctx, first)).toMatchObject({ ok: true });
    expect(await createTask(ctx, { ...deck, title: 'D' })).toMatchObject({ ok: true });
  });
});

describe('Anfangen', () => {
  it('hält Tag, Gefühl und den verkleinerten Schritt fest; ein zweiter Tipp ändert nichts', async () => {
    const id = await create();
    day('2026-11-10');
    const r = await startTask(ctx, id, { aversion: 3, reason: 'UNCLEAR', firstStep: '  Drei Überschriften ' });
    expect(r).toEqual({ ok: true, late: false });
    expect(await stored(id)).toMatchObject({ startedOn: '2026-11-10', startAversion: 3, startReason: 'UNCLEAR', firstStep: 'Drei Überschriften' });

    day('2026-11-11');
    expect(await startTask(ctx, id)).toEqual({ ok: false, reason: 'ALREADY_STARTED' });
    expect((await stored(id)).startedOn).toBe('2026-11-10');
    expect((await loadTodayView(ctx)).tasks).toMatchObject([{ phase: 'RUNNING', lateQuestion: false }]);
  });

  it('ohne Angaben zum Gefühl geht es auch; ein leerer Schritt nicht', async () => {
    const id = await create({ plannedStart: '2026-11-09' });
    expect(await startTask(ctx, id, { firstStep: '   ' })).toEqual({ ok: false, reason: 'STEP_INVALID' });
    expect(await startTask(ctx, id, { aversion: null, reason: null })).toEqual({ ok: true, late: false });
    const task = await stored(id);
    expect(task.startAversion).toBeUndefined();
    expect(task.startReason).toBeUndefined();
  });

  it('nach einem späten Start steht genau eine Frage an, die Antwort beendet sie', async () => {
    const id = await create();
    day('2026-11-12');
    expect((await loadTodayView(ctx)).tasks).toMatchObject([{ phase: 'DUE', waitingDays: 2 }]);
    expect(await startTask(ctx, id)).toEqual({ ok: true, late: true });
    expect((await loadTodayView(ctx)).tasks).toMatchObject([{ phase: 'RUNNING', lateQuestion: true }]);

    expect(await answerLateStart(ctx, id, 'SMALLER_STEP')).toEqual({ ok: true });
    expect((await loadTodayView(ctx)).tasks).toMatchObject([{ lateQuestion: false }]);
    expect((await stored(id)).lateStartChoice).toBe('SMALLER_STEP');
  });

  it('die Frage nach dem späten Start gibt es nur nach einem späten Start', async () => {
    const id = await create({ plannedStart: '2026-11-09' });
    await startTask(ctx, id);
    expect(await answerLateStart(ctx, id, 'CLARIFY')).toEqual({ ok: false });
  });
});

describe('Bewusst verschieben', () => {
  it('setzt mit Grund einen neuen Start; danach zählt der neue Tag', async () => {
    const id = await create();
    day('2026-11-10');
    expect(await deferTask(ctx, id, '2026-11-12', '')).toEqual({ ok: false, reason: 'REASON_REQUIRED' });
    expect(await deferTask(ctx, id, '2026-11-14', 'x')).toEqual({ ok: false, reason: 'DATE_INVALID' });
    expect(await deferTask(ctx, id, '2026-11-12', ' Input vom Kunden kommt Donnerstag ')).toEqual({ ok: true });

    const task = await stored(id);
    expect(task.plannedStart).toBe('2026-11-12');
    expect(task.deferrals).toMatchObject([{ from: '2026-11-10', to: '2026-11-12', reason: 'Input vom Kunden kommt Donnerstag' }]);
    expect((await loadTodayView(ctx)).tasks).toEqual([]);

    day('2026-11-12');
    expect(await startTask(ctx, id)).toEqual({ ok: true, late: false });
    expect(await deferTask(ctx, id, '2026-11-13', 'zu spät')).toEqual({ ok: false, reason: 'ALREADY_STARTED' });
  });

  it('ein Review vor dem neuen Start rückt auf den Starttag', async () => {
    const id = await create({ reviewOn: '2026-11-11' });
    day('2026-11-10');
    await deferTask(ctx, id, '2026-11-12', 'Kunde');
    expect((await stored(id)).reviewOn).toBe('2026-11-12');
  });
});

describe('Bearbeiten', () => {
  it('ändert Angaben; der geplante Start nur, solange er nicht erreicht ist', async () => {
    const id = await create();
    expect(await updateTask(ctx, id, { ...deck, title: 'Deck v2', plannedStart: '2026-11-11', reviewOn: '' })).toEqual({ ok: true, taskId: id });
    expect(await stored(id)).toMatchObject({ title: 'Deck v2', plannedStart: '2026-11-11' });
    expect((await stored(id)).reviewOn).toBeUndefined();

    day('2026-11-11');
    const r = await updateTask(ctx, id, { ...deck, plannedStart: '2026-11-12' });
    expect(r).toEqual({ ok: false, errors: { plannedStart: 'INVALID' } });
    expect(await updateTask(ctx, id, { ...deck, plannedStart: '2026-11-11', estimateMinutes: 300 })).toMatchObject({ ok: true });
    expect((await stored(id)).estimateMinutes).toBe(300);
  });

  it('abgeschlossene Vorhaben lassen sich nicht mehr bearbeiten', async () => {
    const id = await create({ plannedStart: '2026-11-09' });
    await finishTask(ctx, id);
    expect(await loadTaskForm(ctx, id)).toBeUndefined();
    expect(await updateTask(ctx, id, deck)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('Review, Abschluss, Beenden, Löschen', () => {
  it('Review und Abschluss mit Minuten; der Puffer zur Deadline kommt zurück', async () => {
    const id = await create();
    day('2026-11-10');
    await startTask(ctx, id);
    day('2026-11-11');
    expect(await markReviewDone(ctx, id)).toEqual({ ok: true });
    expect((await loadTodayView(ctx)).tasks).toMatchObject([{ reviewOpen: false }]);

    day('2026-11-12');
    expect(await finishTask(ctx, id, 'viel')).toEqual({ ok: false, reason: 'MINUTES_INVALID' });
    expect(await finishTask(ctx, id, '300')).toEqual({ ok: true, buffer: 1 });
    expect(await stored(id)).toMatchObject({ status: 'DONE', finishedOn: '2026-11-12', actualMinutes: 300, reviewDoneOn: '2026-11-11' });
    expect((await loadTodayView(ctx)).tasks).toEqual([]);
    expect((await loadPlanView(ctx)).tasks.closed.map((t) => t.id)).toEqual([id]);
    // Ein zweiter Abschluss findet nichts mehr.
    expect(await finishTask(ctx, id)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('Abschluss ohne eingetragenen Start nimmt den Tag des Abschlusses als Start', async () => {
    const id = await create();
    day('2026-11-14');
    expect(await finishTask(ctx, id, '')).toEqual({ ok: true, buffer: -1 });
    const task = await stored(id);
    expect(task.startedOn).toBe('2026-11-14');
    expect(task.actualMinutes).toBeUndefined();
  });

  it('ohne vorgesehenen Review gibt es nichts einzuholen', async () => {
    const id = await create({ reviewOn: '' });
    expect(await markReviewDone(ctx, id)).toEqual({ ok: false });
  });

  it('„Nicht mehr nötig“ nimmt das Vorhaben aus allem heraus, Löschen hinterlässt eine Löschmarkierung', async () => {
    const dropped = await create({ plannedStart: '2026-11-09' });
    const removed = await create({ title: 'Analyse', plannedStart: '2026-11-09' });
    await startTask(ctx, dropped);
    expect(await dropTask(ctx, dropped)).toEqual({ ok: true });
    expect(await deleteTask(ctx, removed)).toEqual({ ok: true });
    expect(await deleteTask(ctx, removed)).toEqual({ ok: false });

    expect((await loadTodayView(ctx)).tasks).toEqual([]);
    expect((await loadHistoryView(ctx)).tasks).toMatchObject({ hasTasks: false, metrics: { started: 0 } });
    const snapshot = await ctx.repo.loadSnapshot();
    expect(snapshot.tasks.find((t) => t.id === removed)).toEqual({ id: removed, deletedAt: expect.any(String) });
  });
});

describe('Kennzahlen im Verlauf und Beleg im Wochenrückblick', () => {
  async function runTask(title: string, planned: string, started: string, finished: string, minutes: string): Promise<void> {
    const id = await create({ title, plannedStart: planned, deadline: '2026-11-27', reviewOn: '' });
    day(started);
    await startTask(ctx, id);
    day(finished);
    await finishTask(ctx, id, minutes);
  }

  it('Verlauf zeigt Start gegenüber Plan, Puffer und Schätzfaktor; ohne Gewohnheiten bleibt der Rest leer', async () => {
    await runTask('A', '2026-11-09', '2026-11-09', '2026-11-10', '240');
    await runTask('B', '2026-11-10', '2026-11-12', '2026-11-13', '480');
    await runTask('C', '2026-11-13', '2026-11-13', '2026-11-16', '360');

    day('2026-11-17');
    const view = await loadHistoryView(ctx);
    expect(view.hasHabits).toBe(false);
    expect(view.tasks.hasTasks).toBe(true);
    expect(view.tasks.metrics).toMatchObject({
      started: 3,
      onTime: 2,
      latency: { count: 3, median: 0 },
      buffer: { count: 3, median: 14 },
      estimateFactor: { count: 3, median: 1.5 },
      reviews: { planned: 0, timely: 0 },
    });
    // Laufende Woche (ab Montag, 16. Nov.): noch kein Start.
    expect(view.tasks.week).toBeUndefined();
  });

  it('der Wochenrückblick nennt, wie viele Vorhaben der Woche spätestens am geplanten Tag begonnen wurden', async () => {
    await completeOnboarding(ctx, {
      goal: { title: 'Mehr Bewegung' },
      habit: { actionText: '10 Minuten spazieren', minimumText: '2 Minuten', cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' } },
    });
    await runTask('A', '2026-11-09', '2026-11-09', '2026-11-10', '');
    await runTask('B', '2026-11-10', '2026-11-12', '2026-11-13', '');

    day('2026-11-15'); // Sonntag: der Rückblick steht an
    const review = await loadReviewView(ctx);
    expect(review.state).toBe('DUE');
    expect(review.taskProof).toEqual({ started: 2, onTime: 1 });
    expect((await loadHistoryView(ctx)).tasks.week).toEqual({ started: 2, onTime: 1 });
  });
});

describe('Export und Zusammenführen', () => {
  it('Vorhaben wandern mit der Exportdatei auf ein zweites Gerät', async () => {
    const id = await create({ plannedStart: '2026-11-09' });
    await startTask(ctx, id, { aversion: 2 });
    const file = await exportBackup(ctx, '0.1.0');

    const clock = fixedClock('2026-11-09T12:00:00+01:00');
    const other: AppContext = { repo: await IdbRepository.open({ name: `tasks-${++dbSeq}`, now: () => clock.now() }), clock, newId: counterIds('o') };
    try {
      const parsed = JSON.parse(file.text) as { formatVersion: number };
      expect(parsed.formatVersion).toBe(2);
      const backup = parseBackupText(file.text);
      if (backup.kind !== 'plain') throw new Error('unverschlüsselt erwartet');
      await importMerge(other, backup.backup);
      expect((await other.repo.loadLive()).tasks).toMatchObject([{ id, startedOn: '2026-11-09', startAversion: 2 }]);
    } finally {
      other.repo.close();
    }
  });
});
