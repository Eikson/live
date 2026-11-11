import { appConfig } from './app-config';
import { addDays, diffDays, isLocalDate, type LocalDate } from './local-date';
import type { FieldError, FieldErrors } from './planning';
import type { AversionReason, LateStartChoice, Task } from './types';

/**
 * Regeln für Vorhaben: einmalige Aufgaben mit Deadline. Rein und ohne Browser-APIs.
 * Gemessen wird die Lücke zwischen geplantem und tatsächlichem Start. Bewusstes Verschieben
 * mit Grund setzt einen neuen geplanten Start und zählt nicht als Aufschieben.
 */
export const AVERSION_REASONS: readonly AversionReason[] = ['UNCLEAR', 'BORING', 'FEAR', 'TOO_BIG', 'NO_ENERGY', 'OTHER'];
export const LATE_START_CHOICES: readonly Exclude<LateStartChoice, 'SKIPPED'>[] = [
  'SMALLER_STEP',
  'EARLIER_REVIEW',
  'CLEARER_START',
  'LESS_PARALLEL',
  'CLARIFY',
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const { short, long } = appConfig.textLimits;

export type TaskField = 'title' | 'deadline' | 'plannedStart' | 'plannedStartTime' | 'firstStep' | 'estimateMinutes' | 'reviewOn';

export interface TaskInput {
  title: string;
  deadline: string;
  plannedStart: string;
  plannedStartTime?: string;
  firstStep: string;
  /** Zahl oder Text aus dem Formular */
  estimateMinutes: number | string;
  reviewOn?: string;
}

export interface TaskValues {
  title: string;
  deadline: LocalDate;
  plannedStart: LocalDate;
  plannedStartTime?: string;
  firstStep: string;
  estimateMinutes: number;
  reviewOn?: LocalDate;
}

function checkText(value: string, max: number): FieldError | undefined {
  if (value.length === 0) return 'REQUIRED';
  return value.length > max ? 'TOO_LONG' : undefined;
}

/** Ganze Minuten von 1 bis zur Obergrenze, sonst `undefined`. */
export function parseMinutes(value: number | string | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 && n <= appConfig.tasks.maxMinutes ? n : undefined;
}

/**
 * Prüft die Angaben zu einem Vorhaben. `today` gilt für neue Vorhaben: Deadline und geplanter
 * Start liegen nicht in der Vergangenheit. Beim Bearbeiten (`existing`) bleiben der geplante
 * Start eines schon begonnenen Vorhabens und ein unveränderter früherer Start erlaubt.
 */
export function normalizeTaskInput(
  input: TaskInput,
  today: LocalDate,
  existing?: Pick<Task, 'plannedStart' | 'startedOn' | 'deadline'>,
): { value: TaskValues; errors: FieldErrors<TaskField> } {
  const title = input.title.trim();
  const firstStep = input.firstStep.trim();
  const deadline = input.deadline.trim();
  const plannedStart = input.plannedStart.trim();
  const time = (input.plannedStartTime ?? '').trim();
  const reviewOn = (input.reviewOn ?? '').trim();
  const minutes = parseMinutes(input.estimateMinutes);
  const errors: FieldErrors<TaskField> = {};

  const titleError = checkText(title, short);
  if (titleError) errors.title = titleError;
  const stepError = checkText(firstStep, long);
  if (stepError) errors.firstStep = stepError;

  if (!deadline) errors.deadline = 'REQUIRED';
  else if (!isLocalDate(deadline) || (deadline < today && deadline !== existing?.deadline)) errors.deadline = 'INVALID';

  if (!plannedStart) errors.plannedStart = 'REQUIRED';
  else if (!isLocalDate(plannedStart)) errors.plannedStart = 'INVALID';
  else if (
    plannedStart !== existing?.plannedStart &&
    // Ein erreichter oder begonnener Start ändert sich nur über „Verschieben“ mit Grund.
    (plannedStart < today || (existing !== undefined && (existing.startedOn !== undefined || existing.plannedStart <= today)))
  ) {
    errors.plannedStart = 'INVALID';
  } else if (!errors.deadline && plannedStart > deadline) errors.plannedStart = 'INVALID';

  if (time && !TIME.test(time)) errors.plannedStartTime = 'INVALID';

  if (String(input.estimateMinutes).trim() === '') errors.estimateMinutes = 'REQUIRED';
  else if (minutes === undefined) errors.estimateMinutes = 'INVALID';

  if (reviewOn) {
    if (!isLocalDate(reviewOn)) errors.reviewOn = 'INVALID';
    else if (!errors.deadline && reviewOn > deadline) errors.reviewOn = 'INVALID';
    else if (!errors.plannedStart && reviewOn < plannedStart) errors.reviewOn = 'INVALID';
  }

  const value: TaskValues = { title, deadline, plannedStart, firstStep, estimateMinutes: minutes ?? 0 };
  if (time) value.plannedStartTime = time;
  if (reviewOn) value.reviewOn = reviewOn;
  return { value, errors };
}

export type DeferError = 'REASON_REQUIRED' | 'REASON_TOO_LONG' | 'DATE_INVALID';

/** Bewusst verschieben: neuer Tag ab heute, nicht nach der Deadline, anders als bisher, mit Grund. */
export function checkDeferral(task: Task, to: string, reason: string, today: LocalDate): DeferError | undefined {
  if (!isLocalDate(to) || to < today || to > task.deadline || to === task.plannedStart) return 'DATE_INVALID';
  const text = reason.trim();
  if (!text) return 'REASON_REQUIRED';
  return text.length > short ? 'REASON_TOO_LONG' : undefined;
}

export type TaskPhase = 'UPCOMING' | 'DUE' | 'RUNNING' | 'CLOSED';

export function taskPhase(task: Task, today: LocalDate): TaskPhase {
  if (task.status !== 'OPEN') return 'CLOSED';
  if (task.startedOn !== undefined) return 'RUNNING';
  return task.plannedStart <= today ? 'DUE' : 'UPCOMING';
}

/** Tage zwischen geplantem und tatsächlichem Start; 0 oder negativ heißt: nicht später als geplant. */
export function startLatency(task: Task): number | undefined {
  return task.startedOn === undefined ? undefined : diffDays(task.plannedStart, task.startedOn);
}

export function startedLate(task: Task): boolean {
  return (startLatency(task) ?? 0) > 0;
}

/** Die Frage nach einem späten Start steht noch aus. */
export function lateQuestionOpen(task: Task): boolean {
  return task.status === 'OPEN' && startedLate(task) && task.lateStartChoice === undefined;
}

/** Tage, die der geplante Start heute zurückliegt (nur solange nicht begonnen). */
export function waitingDays(task: Task, today: LocalDate): number {
  return task.startedOn === undefined && task.status === 'OPEN' ? Math.max(0, diffDays(task.plannedStart, today)) : 0;
}

/** Tage zwischen Abschluss und Deadline; positiv heißt: vor der Deadline fertig. */
export function deadlineBuffer(task: Task): number | undefined {
  return task.status === 'DONE' && task.finishedOn !== undefined ? diffDays(task.finishedOn, task.deadline) : undefined;
}

/** Ein eingeholter Review zählt als rechtzeitig, wenn er spätestens am vorgesehenen Tag lag. */
export function reviewTimely(task: Task): boolean | undefined {
  if (task.reviewOn === undefined) return undefined;
  return task.reviewDoneOn !== undefined && task.reviewDoneOn <= task.reviewOn;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Ein Wert erscheint erst ab `minForMedian` Datenpunkten; vorher nur die Anzahl. */
export interface Measure {
  count: number;
  median?: number;
}

function measure(values: readonly number[]): Measure {
  const m = values.length >= appConfig.tasks.minForMedian ? median(values) : undefined;
  return { count: values.length, ...(m !== undefined ? { median: m } : {}) };
}

export interface TaskMetrics {
  /** Begonnene Vorhaben im Zeitraum */
  started: number;
  /** davon spätestens am geplanten Tag begonnen */
  onTime: number;
  /** Tage zwischen geplantem und tatsächlichem Start */
  latency: Measure;
  /** Tage zwischen Abschluss und Deadline */
  buffer: Measure;
  /** tatsächliche durch geschätzte Minuten */
  estimateFactor: Measure;
  /** Abgeschlossene Vorhaben mit vorgesehenem Review und wie viele davon rechtzeitig */
  reviews: { planned: number; timely: number };
  /** Bewusst verschoben, mit Grund */
  deferrals: number;
  /** Offene Vorhaben, deren geplanter Start vorbei ist */
  waiting: number;
}

/**
 * Kennzahlen der letzten `metricsDays` Tage. Verworfene Vorhaben zählen nirgends mit.
 * Maßgeblich ist der Tag des Starts (Startwerte) bzw. des Abschlusses (alles Weitere).
 */
export function taskMetrics(tasks: readonly Task[], today: LocalDate): TaskMetrics {
  const from = addDays(today, -(appConfig.tasks.metricsDays - 1));
  const inWindow = (d: LocalDate | undefined): d is LocalDate => d !== undefined && d >= from && d <= today;
  const counted = tasks.filter((t) => t.status !== 'DROPPED');
  const started = counted.filter((t) => inWindow(t.startedOn));
  const finished = counted.filter((t) => t.status === 'DONE' && inWindow(t.finishedOn));
  const withReview = finished.filter((t) => t.reviewOn !== undefined);
  return {
    started: started.length,
    onTime: started.filter((t) => !startedLate(t)).length,
    latency: measure(started.map((t) => Math.max(0, startLatency(t)!))),
    buffer: measure(finished.map((t) => deadlineBuffer(t)!)),
    estimateFactor: measure(
      finished.filter((t) => t.actualMinutes !== undefined && t.estimateMinutes > 0).map((t) => t.actualMinutes! / t.estimateMinutes),
    ),
    reviews: { planned: withReview.length, timely: withReview.filter((t) => reviewTimely(t)).length },
    deferrals: counted.reduce((n, t) => n + t.deferrals.filter((d) => inWindow(d.at.slice(0, 10))).length, 0),
    waiting: counted.filter((t) => waitingDays(t, today) > 0).length,
  };
}

/** Beleg für eine Woche: wie viele Vorhaben begonnen wurden und wie viele davon nicht später als geplant. */
export function weekProof(tasks: readonly Task[], from: LocalDate, to: LocalDate): { started: number; onTime: number } | undefined {
  const started = tasks.filter((t) => t.status !== 'DROPPED' && t.startedOn !== undefined && t.startedOn >= from && t.startedOn <= to);
  if (started.length === 0) return undefined;
  return { started: started.length, onTime: started.filter((t) => !startedLate(t)).length };
}

/** Offene Vorhaben: fällige zuerst (ältester geplanter Start oben), dann laufende, dann kommende. */
export function sortOpenTasks(tasks: readonly Task[], today: LocalDate): Task[] {
  const rank: Record<TaskPhase, number> = { DUE: 0, RUNNING: 1, UPCOMING: 2, CLOSED: 3 };
  return tasks
    .filter((t) => t.status === 'OPEN')
    .sort(
      (a, b) =>
        rank[taskPhase(a, today)] - rank[taskPhase(b, today)] ||
        a.plannedStart.localeCompare(b.plannedStart) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export function canAddTask(tasks: readonly Task[]): boolean {
  return tasks.filter((t) => t.status === 'OPEN').length < appConfig.tasks.maxOpen;
}
