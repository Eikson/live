import { describe, expect, it } from 'vitest';
import { icsFileName, taskIcs } from '../../src/domain/ics';
import { mergeSnapshots } from '../../src/domain/merge';
import { BackupError, createBackup, parseBackupObject } from '../../src/domain/backup-schema';
import {
  canAddTask,
  checkDeferral,
  lateQuestionOpen,
  median,
  normalizeTaskInput,
  parseMinutes,
  sortOpenTasks,
  startLatency,
  taskMetrics,
  taskPhase,
  waitingDays,
  weekProof,
  type TaskInput,
} from '../../src/domain/task';
import type { Task } from '../../src/domain/types';
import { sampleSnapshot } from '../backup-fixture';
import { NOW } from '../helpers';

const TODAY = '2026-11-09'; // Montag

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Steering-Deck',
    deadline: '2026-11-13',
    plannedStart: '2026-11-09',
    firstStep: 'Fünf Überschriften für die Storyline',
    estimateMinutes: 240,
    status: 'OPEN',
    deferrals: [],
    createdOn: '2026-11-06',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const input = (overrides: Partial<TaskInput> = {}): TaskInput => ({
  title: ' Steering-Deck ',
  deadline: '2026-11-13',
  plannedStart: '2026-11-10',
  firstStep: ' Fünf Überschriften ',
  estimateMinutes: '240',
  ...overrides,
});

describe('Angaben zu einem Vorhaben', () => {
  it('übernimmt bereinigte Werte', () => {
    const { value, errors } = normalizeTaskInput(input({ plannedStartTime: '09:15', reviewOn: '2026-11-11' }), TODAY);
    expect(errors).toEqual({});
    expect(value).toEqual({
      title: 'Steering-Deck',
      deadline: '2026-11-13',
      plannedStart: '2026-11-10',
      plannedStartTime: '09:15',
      firstStep: 'Fünf Überschriften',
      estimateMinutes: 240,
      reviewOn: '2026-11-11',
    });
  });

  it('verlangt Titel, Deadline, Start, ersten Schritt und Schätzung', () => {
    const { errors } = normalizeTaskInput({ title: '', deadline: '', plannedStart: '', firstStep: ' ', estimateMinutes: '' }, TODAY);
    expect(errors).toEqual({
      title: 'REQUIRED',
      deadline: 'REQUIRED',
      plannedStart: 'REQUIRED',
      firstStep: 'REQUIRED',
      estimateMinutes: 'REQUIRED',
    });
  });

  it('lehnt unstimmige Tage, Uhrzeiten und Minuten ab', () => {
    const errorsOf = (o: Partial<TaskInput>) => normalizeTaskInput(input(o), TODAY).errors;
    expect(errorsOf({ deadline: '2026-11-08' }).deadline).toBe('INVALID'); // Vergangenheit
    expect(errorsOf({ deadline: '2026-02-30' }).deadline).toBe('INVALID'); // kein Kalendertag
    expect(errorsOf({ plannedStart: '2026-11-08' }).plannedStart).toBe('INVALID'); // Vergangenheit
    expect(errorsOf({ plannedStart: '2026-11-14' }).plannedStart).toBe('INVALID'); // nach der Deadline
    expect(errorsOf({ plannedStartTime: '25:00' }).plannedStartTime).toBe('INVALID');
    expect(errorsOf({ estimateMinutes: '0' }).estimateMinutes).toBe('INVALID');
    expect(errorsOf({ estimateMinutes: '12,5' }).estimateMinutes).toBe('INVALID');
    expect(errorsOf({ estimateMinutes: '6001' }).estimateMinutes).toBe('INVALID');
    expect(errorsOf({ reviewOn: '2026-11-09' }).reviewOn).toBe('INVALID'); // vor dem Start
    expect(errorsOf({ reviewOn: '2026-11-14' }).reviewOn).toBe('INVALID'); // nach der Deadline
    expect(errorsOf({ title: 'x'.repeat(121) }).title).toBe('TOO_LONG');
  });

  it('heute als Start und Deadline ist erlaubt', () => {
    expect(normalizeTaskInput(input({ deadline: TODAY, plannedStart: TODAY }), TODAY).errors).toEqual({});
  });

  it('beim Bearbeiten bleibt ein erreichter Start, wie er ist; ändern geht nur vor dem Start', () => {
    const reached = makeTask({ plannedStart: '2026-11-06' });
    expect(normalizeTaskInput(input({ plannedStart: '2026-11-06' }), TODAY, reached).errors).toEqual({});
    expect(normalizeTaskInput(input({ plannedStart: '2026-11-11' }), TODAY, reached).errors.plannedStart).toBe('INVALID');
    const upcoming = makeTask({ plannedStart: '2026-11-11' });
    expect(normalizeTaskInput(input({ plannedStart: '2026-11-12' }), TODAY, upcoming).errors).toEqual({});
    // Eine schon verstrichene Deadline darf beim Bearbeiten stehen bleiben.
    const overdue = makeTask({ plannedStart: '2026-11-02', deadline: '2026-11-06' });
    expect(normalizeTaskInput(input({ plannedStart: '2026-11-02', deadline: '2026-11-06' }), TODAY, overdue).errors).toEqual({});
  });

  it('liest Minuten nur als ganze Zahl im erlaubten Bereich', () => {
    expect(parseMinutes(' 90 ')).toBe(90);
    expect(parseMinutes(45)).toBe(45);
    expect(parseMinutes('')).toBeUndefined();
    expect(parseMinutes('-5')).toBeUndefined();
    expect(parseMinutes('1e3')).toBeUndefined();
  });
});

describe('Phasen und Startlatenz', () => {
  it('kommend, fällig, laufend, abgeschlossen', () => {
    expect(taskPhase(makeTask({ plannedStart: '2026-11-10' }), TODAY)).toBe('UPCOMING');
    expect(taskPhase(makeTask(), TODAY)).toBe('DUE');
    expect(taskPhase(makeTask({ startedOn: TODAY }), TODAY)).toBe('RUNNING');
    expect(taskPhase(makeTask({ status: 'DONE', startedOn: TODAY, finishedOn: TODAY }), TODAY)).toBe('CLOSED');
  });

  it('misst die Tage zwischen geplantem und tatsächlichem Start', () => {
    expect(startLatency(makeTask())).toBeUndefined();
    expect(startLatency(makeTask({ startedOn: '2026-11-09' }))).toBe(0);
    expect(startLatency(makeTask({ startedOn: '2026-11-12' }))).toBe(3);
    expect(startLatency(makeTask({ plannedStart: '2026-11-11', startedOn: '2026-11-10' }))).toBe(-1);
  });

  it('zählt Wartetage nur, solange nicht begonnen wurde', () => {
    expect(waitingDays(makeTask({ plannedStart: '2026-11-06' }), TODAY)).toBe(3);
    expect(waitingDays(makeTask({ plannedStart: '2026-11-06', startedOn: '2026-11-08' }), TODAY)).toBe(0);
    expect(waitingDays(makeTask({ plannedStart: '2026-11-12' }), TODAY)).toBe(0);
  });

  it('fragt nach einem späten Start genau einmal', () => {
    const late = makeTask({ startedOn: '2026-11-11' });
    expect(lateQuestionOpen(late)).toBe(true);
    expect(lateQuestionOpen({ ...late, lateStartChoice: 'SKIPPED' })).toBe(false);
    expect(lateQuestionOpen(makeTask({ startedOn: '2026-11-09' }))).toBe(false);
  });

  it('sortiert fällige vor laufenden vor kommenden und begrenzt offene Vorhaben', () => {
    const tasks = [
      makeTask({ id: 'kommt', plannedStart: '2026-11-11' }),
      makeTask({ id: 'läuft', plannedStart: '2026-11-05', startedOn: '2026-11-05' }),
      makeTask({ id: 'fällig-neu' }),
      makeTask({ id: 'fällig-alt', plannedStart: '2026-11-06' }),
      makeTask({ id: 'fertig', status: 'DONE', startedOn: '2026-11-02', finishedOn: '2026-11-03' }),
    ];
    expect(sortOpenTasks(tasks, TODAY).map((t) => t.id)).toEqual(['fällig-alt', 'fällig-neu', 'läuft', 'kommt']);
    expect(canAddTask(tasks)).toBe(false);
    expect(canAddTask(tasks.slice(0, 2))).toBe(true);
  });
});

describe('Bewusst verschieben', () => {
  const task = makeTask({ plannedStart: '2026-11-06' });
  it('verlangt einen neuen Tag ab heute bis zur Deadline und einen Grund', () => {
    expect(checkDeferral(task, '2026-11-11', 'Input kommt erst Mittwoch', TODAY)).toBeUndefined();
    expect(checkDeferral(task, TODAY, 'Heute statt Freitag', TODAY)).toBeUndefined();
    expect(checkDeferral(task, '2026-11-08', 'x', TODAY)).toBe('DATE_INVALID');
    expect(checkDeferral(task, '2026-11-14', 'x', TODAY)).toBe('DATE_INVALID');
    expect(checkDeferral(task, '2026-11-06', 'x', TODAY)).toBe('DATE_INVALID');
    expect(checkDeferral(task, '2026-11-11', '  ', TODAY)).toBe('REASON_REQUIRED');
    expect(checkDeferral(task, '2026-11-11', 'x'.repeat(121), TODAY)).toBe('REASON_TOO_LONG');
  });
});

describe('Kennzahlen', () => {
  const done = (id: string, o: Partial<Task>): Task => makeTask({ id, status: 'DONE', ...o });
  const tasks: Task[] = [
    done('a', { plannedStart: '2026-10-05', startedOn: '2026-10-05', finishedOn: '2026-10-08', deadline: '2026-10-09', estimateMinutes: 100, actualMinutes: 150 }),
    done('b', { plannedStart: '2026-10-12', startedOn: '2026-10-14', finishedOn: '2026-10-16', deadline: '2026-10-16', estimateMinutes: 60, actualMinutes: 120, reviewOn: '2026-10-15', reviewDoneOn: '2026-10-15' }),
    done('c', { plannedStart: '2026-10-19', startedOn: '2026-10-23', finishedOn: '2026-10-24', deadline: '2026-10-23', estimateMinutes: 200, actualMinutes: 200, reviewOn: '2026-10-21', reviewDoneOn: '2026-10-23' }),
    makeTask({
      id: 'offen',
      plannedStart: '2026-11-06',
      deferrals: [{ at: '2026-11-03T09:00:00.000Z', from: '2026-11-04', to: '2026-11-06', reason: 'Kunde' }],
    }),
    makeTask({ id: 'verworfen', status: 'DROPPED', plannedStart: '2026-10-01', startedOn: '2026-10-20' }),
    done('alt', { plannedStart: '2026-05-01', startedOn: '2026-05-20', finishedOn: '2026-05-21', deadline: '2026-05-21' }),
  ];

  it('rechnet Median für Start, Puffer und Schätzung über die letzten 12 Wochen', () => {
    const m = taskMetrics(tasks, TODAY);
    expect(m.started).toBe(3);
    expect(m.onTime).toBe(1);
    expect(m.latency).toEqual({ count: 3, median: 2 }); // 0, 2, 4
    expect(m.buffer).toEqual({ count: 3, median: 0 }); // 1, 0, −1
    expect(m.estimateFactor).toEqual({ count: 3, median: 1.5 }); // 1,5; 2; 1
    expect(m.reviews).toEqual({ planned: 2, timely: 1 });
    expect(m.deferrals).toBe(1);
    expect(m.waiting).toBe(1);
  });

  it('zeigt einen Wert erst ab drei Datenpunkten', () => {
    const m = taskMetrics(tasks.slice(0, 2), TODAY);
    expect(m.latency).toEqual({ count: 2 });
    expect(m.buffer).toEqual({ count: 2 });
  });

  it('ein früherer Start als geplant zählt als Latenz 0', () => {
    const early = [1, 2, 3].map((n) => done(`e${n}`, { plannedStart: '2026-11-05', startedOn: '2026-11-03', finishedOn: '2026-11-04' }));
    expect(taskMetrics(early, TODAY).latency.median).toBe(0);
  });

  it('Median bei gerader und ungerader Anzahl', () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('Wochenbeleg zählt begonnene Vorhaben und davon die nicht später begonnenen', () => {
    expect(weekProof(tasks, '2026-10-12', '2026-10-18')).toEqual({ started: 1, onTime: 0 });
    expect(weekProof(tasks, '2026-10-05', '2026-10-11')).toEqual({ started: 1, onTime: 1 });
    expect(weekProof(tasks, '2026-11-09', '2026-11-15')).toBeUndefined();
    // Verworfene Vorhaben zählen nicht.
    expect(weekProof(tasks, '2026-10-19', '2026-10-25')).toEqual({ started: 1, onTime: 0 });
  });
});

describe('Kalendereintrag', () => {
  const texts = { summary: (title: string) => `Start: ${title}`, description: (t: Task) => `Erster Schritt: ${t.firstStep}\nDeadline: ${t.deadline}` };

  it('ganztägig ohne Uhrzeit, mit Zeilenenden nach RFC 5545', () => {
    const ics = taskIcs(makeTask({ title: 'Deck; Version 2, final' }), NOW, texts);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n')).toEqual(
      expect.arrayContaining([
        'BEGIN:VEVENT',
        'UID:t1@live',
        'DTSTAMP:20260101T080000Z',
        'SEQUENCE:0',
        'DTSTART;VALUE=DATE:20261109',
        'DTEND;VALUE=DATE:20261110',
        'SUMMARY:Start: Deck\\; Version 2\\, final',
      ]),
    );
    // Lange Zeilen sind umbrochen; für den Vergleich wieder zusammensetzen.
    expect(ics.replace(/\r\n /g, '')).toContain('DESCRIPTION:Erster Schritt: Fünf Überschriften für die Storyline\\nDeadline: 2026');
  });

  it('mit Uhrzeit als Termin über das Startfenster, auch über Mitternacht', () => {
    expect(taskIcs(makeTask({ plannedStartTime: '09:15' }), NOW, texts)).toContain('DTSTART:20261109T091500\r\nDTEND:20261109T093000');
    expect(taskIcs(makeTask({ plannedStartTime: '23:50' }), NOW, texts)).toContain('DTSTART:20261109T235000\r\nDTEND:20261110T000500');
  });

  it('bricht lange Zeilen nach 75 Oktetten um und zählt Verschiebungen als neue Fassung', () => {
    const task = makeTask({
      firstStep: 'ä'.repeat(120),
      deferrals: [{ at: NOW, from: '2026-11-06', to: '2026-11-09', reason: 'Kunde' }],
    });
    const ics = taskIcs(task, NOW, texts);
    expect(ics).toContain('SEQUENCE:1');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, '')).toContain('ä'.repeat(120));
  });

  it('Dateiname ohne Sonderzeichen', () => {
    expect(icsFileName('Steering-Deck für Q4 (Größe)')).toBe('live-start-steering-deck-fuer-q4-groesse.ics');
    expect(icsFileName('???')).toBe('live-start-vorhaben.ics');
  });
});

describe('Vorhaben im Export und beim Zusammenführen', () => {
  const withTasks = (tasks: unknown[]) => {
    const file = JSON.parse(JSON.stringify(createBackup(sampleSnapshot(), NOW, '0.1.0'))) as { data: { tasks: unknown[] } };
    file.data.tasks = tasks;
    return file;
  };

  it('übersteht den Weg über die Datei, unbekannte Felder fallen weg', () => {
    const task = makeTask({
      plannedStartTime: '09:15',
      reviewOn: '2026-11-11',
      startedOn: '2026-11-10',
      startAversion: 3,
      startReason: 'UNCLEAR',
      lateStartChoice: 'SMALLER_STEP',
      deferrals: [{ at: NOW, from: '2026-11-06', to: '2026-11-09', reason: 'Kunde' }],
    });
    const parsed = parseBackupObject(withTasks([{ ...task, fremd: true }, { id: 't-alt', deletedAt: NOW }]));
    expect(parsed.kind === 'plain' && parsed.backup.data.tasks).toEqual([task, { id: 't-alt', deletedAt: NOW }]);
  });

  it('lehnt unstimmige Vorhaben ab', () => {
    const invalid = (o: Record<string, unknown>) => {
      try {
        parseBackupObject(withTasks([{ ...makeTask(), ...o }]));
      } catch (e) {
        return e instanceof BackupError ? e.code : 'ANDERER FEHLER';
      }
      return undefined;
    };
    expect(invalid({ deadline: '13.11.2026' })).toBe('INVALID');
    expect(invalid({ status: 'LATER' })).toBe('INVALID');
    expect(invalid({ estimateMinutes: 0 })).toBe('INVALID');
    expect(invalid({ startAversion: 5 })).toBe('INVALID');
    expect(invalid({ status: 'DONE' })).toBe('INVALID'); // Abschluss ohne Tag
    expect(invalid({ deferrals: [{ at: NOW, from: '2026-11-06', to: 'morgen', reason: 'x' }] })).toBe('INVALID');
    expect(invalid({})).toBeUndefined();
  });

  it('beim Zusammenführen gewinnt je Vorhaben der neuere Stand, Löschungen wirken weiter', () => {
    const later = '2026-01-02T08:00:00.000Z';
    const local = { ...sampleSnapshot(), tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b', title: 'lokal', updatedAt: later })] };
    const incoming = {
      ...sampleSnapshot(),
      tasks: [{ id: 'a', deletedAt: later }, makeTask({ id: 'b', title: 'fremd' }), makeTask({ id: 'c' })],
    };
    const merged = mergeSnapshots(local, incoming).tasks;
    expect(merged).toEqual([{ id: 'a', deletedAt: later }, expect.objectContaining({ id: 'b', title: 'lokal' }), expect.objectContaining({ id: 'c' })]);
    // Dieselbe Datei noch einmal ändert nichts.
    expect(mergeSnapshots({ ...local, tasks: merged }, incoming).tasks).toEqual(merged);
  });
});
