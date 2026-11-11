import { appConfig } from '../domain/app-config';
import { diffDays, type LocalDate } from '../domain/local-date';
import type { FieldErrors } from '../domain/planning';
import {
  AVERSION_REASONS,
  canAddTask,
  checkDeferral,
  deadlineBuffer,
  lateQuestionOpen,
  normalizeTaskInput,
  parseMinutes,
  sortOpenTasks,
  startedLate,
  taskPhase,
  waitingDays,
  type DeferError,
  type TaskField,
  type TaskInput,
  type TaskPhase,
} from '../domain/task';
import type { AversionReason, LateStartChoice, Task } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';

/** Ein offenes Vorhaben, wie es „Heute“ und der Plan zeigen. */
export interface TaskItem {
  task: Task;
  phase: TaskPhase;
  /** Tage, die der geplante Start zurückliegt (nur solange nicht begonnen) */
  waitingDays: number;
  /** Tage bis zur Deadline; negativ, wenn sie vorbei ist */
  daysToDeadline: number;
  /** Die Frage nach einem späten Start steht noch aus. */
  lateQuestion: boolean;
  /** Ein Review ist vorgesehen und noch nicht eingeholt. */
  reviewOpen: boolean;
}

export function taskItem(task: Task, now: LocalDate): TaskItem {
  return {
    task,
    phase: taskPhase(task, now),
    waitingDays: waitingDays(task, now),
    daysToDeadline: diffDays(now, task.deadline),
    lateQuestion: lateQuestionOpen(task),
    reviewOpen: task.reviewOn !== undefined && task.reviewDoneOn === undefined,
  };
}

/** Für „Heute“: fällige und laufende Vorhaben, fällige zuerst. Kommende stehen nur im Plan. */
export function todayTasks(tasks: readonly Task[], now: LocalDate): TaskItem[] {
  return sortOpenTasks(tasks, now)
    .map((t) => taskItem(t, now))
    .filter((i) => i.phase === 'DUE' || i.phase === 'RUNNING');
}

export interface TaskListView {
  today: LocalDate;
  open: TaskItem[];
  /** Abgeschlossene und verworfene, neueste zuerst */
  closed: Task[];
  canAdd: boolean;
}

export function taskListView(tasks: readonly Task[], now: LocalDate): TaskListView {
  return {
    today: now,
    open: sortOpenTasks(tasks, now).map((t) => taskItem(t, now)),
    closed: tasks.filter((t) => t.status !== 'OPEN').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    canAdd: canAddTask(tasks),
  };
}

export interface TaskFormContext {
  today: LocalDate;
  /** Beim Bearbeiten das bestehende Vorhaben */
  task?: Task;
  canAdd: boolean;
}

export async function loadTaskForm(ctx: AppContext, taskId?: string): Promise<TaskFormContext | undefined> {
  const data = await ctx.repo.loadLive();
  const now = today(ctx.clock);
  if (taskId === undefined) return { today: now, canAdd: canAddTask(data.tasks) };
  const task = data.tasks.find((t) => t.id === taskId && t.status === 'OPEN');
  return task ? { today: now, task, canAdd: true } : undefined;
}

async function findOpen(ctx: AppContext, taskId: string): Promise<Task | undefined> {
  const data = await ctx.repo.loadLive();
  return data.tasks.find((t) => t.id === taskId && t.status === 'OPEN');
}

const stamp = (ctx: AppContext) => ctx.clock.now().toISOString();

export type SaveTaskResult =
  | { ok: true; taskId: string }
  | { ok: false; errors: FieldErrors<TaskField> }
  | { ok: false; error: 'LIMIT_REACHED' | 'NOT_FOUND' };

/** Legt ein Vorhaben an. Mehr als `maxOpen` offene Vorhaben gibt es nicht. */
export async function createTask(ctx: AppContext, input: TaskInput): Promise<SaveTaskResult> {
  const now = today(ctx.clock);
  const norm = normalizeTaskInput(input, now);
  if (Object.keys(norm.errors).length > 0) return { ok: false, errors: norm.errors };
  const data = await ctx.repo.loadLive();
  if (!canAddTask(data.tasks)) return { ok: false, error: 'LIMIT_REACHED' };
  const at = stamp(ctx);
  const task: Task = { id: ctx.newId(), ...norm.value, status: 'OPEN', deferrals: [], createdOn: now, createdAt: at, updatedAt: at };
  await ctx.repo.commit({ tasks: [task] });
  return { ok: true, taskId: task.id };
}

/**
 * Bearbeitet ein offenes Vorhaben. Der geplante Start lässt sich hier nur ändern, solange er
 * noch nicht erreicht ist; danach geht das nur über „Verschieben“ mit Grund.
 */
export async function updateTask(ctx: AppContext, taskId: string, input: TaskInput): Promise<SaveTaskResult> {
  const task = await findOpen(ctx, taskId);
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const norm = normalizeTaskInput(input, today(ctx.clock), task);
  if (Object.keys(norm.errors).length > 0) return { ok: false, errors: norm.errors };
  const { plannedStartTime: _t, reviewOn: _r, reviewDoneOn, ...rest } = task;
  const next: Task = { ...rest, ...norm.value, updatedAt: stamp(ctx) };
  // Ein schon eingeholter Review bleibt, solange weiter einer vorgesehen ist.
  if (next.reviewOn !== undefined && reviewDoneOn !== undefined) next.reviewDoneOn = reviewDoneOn;
  await ctx.repo.commit({ tasks: [next] });
  return { ok: true, taskId };
}

export interface StartTaskInput {
  /** 0 bis 4 */
  aversion?: number | null;
  reason?: AversionReason | null;
  /** Der Schritt lässt sich beim Start verkleinern. */
  firstStep?: string;
}

export type StartTaskResult = { ok: true; late: boolean } | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_STARTED' | 'STEP_INVALID' };

/** „Angefangen“: hält den Tag des Starts fest. Ein zweiter Tipp ändert nichts mehr. */
export async function startTask(ctx: AppContext, taskId: string, input: StartTaskInput = {}): Promise<StartTaskResult> {
  const task = await findOpen(ctx, taskId);
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  if (task.startedOn !== undefined) return { ok: false, reason: 'ALREADY_STARTED' };
  const step = input.firstStep === undefined ? task.firstStep : input.firstStep.trim();
  if (!step || step.length > appConfig.textLimits.long) return { ok: false, reason: 'STEP_INVALID' };
  const next: Task = { ...task, firstStep: step, startedOn: today(ctx.clock), updatedAt: stamp(ctx) };
  if (typeof input.aversion === 'number' && Number.isInteger(input.aversion) && input.aversion >= 0 && input.aversion <= 4) {
    next.startAversion = input.aversion;
  }
  if (input.reason && AVERSION_REASONS.includes(input.reason)) next.startReason = input.reason;
  await ctx.repo.commit({ tasks: [next] });
  return { ok: true, late: startedLate(next) };
}

export type DeferTaskResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_STARTED' | DeferError };

/** Bewusst verschieben: neuer geplanter Start mit Grund. Zählt nicht als Aufschieben. */
export async function deferTask(ctx: AppContext, taskId: string, to: string, reason: string): Promise<DeferTaskResult> {
  const task = await findOpen(ctx, taskId);
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  if (task.startedOn !== undefined) return { ok: false, reason: 'ALREADY_STARTED' };
  const error = checkDeferral(task, to, reason, today(ctx.clock));
  if (error) return { ok: false, reason: error };
  const at = stamp(ctx);
  const { reviewOn, ...rest } = task;
  const next: Task = {
    ...rest,
    plannedStart: to,
    deferrals: [...task.deferrals, { at, from: task.plannedStart, to, reason: reason.trim() }],
    updatedAt: at,
  };
  // Ein Review vor dem neuen Start ergäbe keinen Sinn; er rückt auf den Starttag.
  if (reviewOn !== undefined) next.reviewOn = reviewOn < to ? to : reviewOn;
  await ctx.repo.commit({ tasks: [next] });
  return { ok: true };
}

async function change(ctx: AppContext, taskId: string, update: (task: Task, now: LocalDate) => Task | undefined): Promise<{ ok: boolean }> {
  const task = await findOpen(ctx, taskId);
  if (!task) return { ok: false };
  const next = update(task, today(ctx.clock));
  if (!next) return { ok: false };
  await ctx.repo.commit({ tasks: [{ ...next, updatedAt: stamp(ctx) }] });
  return { ok: true };
}

/** Antwort auf die Frage nach einem späten Start; „Überspringen“ beantwortet sie ebenfalls. */
export function answerLateStart(ctx: AppContext, taskId: string, choice: LateStartChoice): Promise<{ ok: boolean }> {
  return change(ctx, taskId, (task) => (startedLate(task) ? { ...task, lateStartChoice: choice } : undefined));
}

export function markReviewDone(ctx: AppContext, taskId: string): Promise<{ ok: boolean }> {
  return change(ctx, taskId, (task, now) => (task.reviewOn !== undefined ? { ...task, reviewDoneOn: now } : undefined));
}

export type FinishTaskResult = { ok: true; buffer: number } | { ok: false; reason: 'NOT_FOUND' | 'MINUTES_INVALID' };

/**
 * „Fertig“: schließt das Vorhaben ab. Die tatsächlichen Minuten sind freiwillig. Wurde der Start
 * nie eingetragen, gilt der Tag des Abschlusses auch als Start.
 */
export async function finishTask(ctx: AppContext, taskId: string, actualMinutes?: number | string | null): Promise<FinishTaskResult> {
  const task = await findOpen(ctx, taskId);
  if (!task) return { ok: false, reason: 'NOT_FOUND' };
  const given = actualMinutes !== undefined && actualMinutes !== null && String(actualMinutes).trim() !== '';
  const minutes = given ? parseMinutes(actualMinutes) : undefined;
  if (given && minutes === undefined) return { ok: false, reason: 'MINUTES_INVALID' };
  const now = today(ctx.clock);
  const next: Task = { ...task, status: 'DONE', startedOn: task.startedOn ?? now, finishedOn: now, updatedAt: stamp(ctx) };
  if (minutes !== undefined) next.actualMinutes = minutes;
  await ctx.repo.commit({ tasks: [next] });
  return { ok: true, buffer: deadlineBuffer(next)! };
}

/** „Nicht mehr nötig“: das Vorhaben fällt aus allen Kennzahlen. */
export function dropTask(ctx: AppContext, taskId: string): Promise<{ ok: boolean }> {
  return change(ctx, taskId, (task) => ({ ...task, status: 'DROPPED' }));
}

export async function deleteTask(ctx: AppContext, taskId: string): Promise<{ ok: boolean }> {
  const data = await ctx.repo.loadLive();
  if (!data.tasks.some((t) => t.id === taskId)) return { ok: false };
  await ctx.repo.commit({ tasks: [{ id: taskId, deletedAt: stamp(ctx) }] });
  return { ok: true };
}
