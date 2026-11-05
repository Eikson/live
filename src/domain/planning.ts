import { appConfig } from './app-config';
import { isValidSchedule, normalizeWeekdays } from './schedule';
import { scoringConfig } from './scoring/config';
import type { CopingPlan, Cue, CueType, HabitKind, Intention, Schedule } from './types';

export type FieldError = 'REQUIRED' | 'TOO_LONG' | 'INVALID';
export type FieldErrors<K extends string> = Partial<Record<K, FieldError>>;

const { short, long } = appConfig.textLimits;

export const MAX_COPING_PLANS = 3;

function text(value: string | undefined | null): string {
  return (value ?? '').trim();
}

function checkText(value: string, max: number, required: boolean): FieldError | undefined {
  if (required && value.length === 0) return 'REQUIRED';
  if (value.length > max) return 'TOO_LONG';
  return undefined;
}

/** Entfernt leere Fehlerschlüssel. */
function compact<K extends string>(errors: Record<K, FieldError | undefined>): FieldErrors<K> {
  const out: FieldErrors<K> = {};
  for (const key of Object.keys(errors) as K[]) if (errors[key]) out[key] = errors[key];
  return out;
}

export interface GoalInput {
  title: string;
  why?: string;
  successSignal?: string;
}

export function normalizeGoalInput(input: GoalInput): {
  value: { title: string; why?: string; successSignal?: string };
  errors: FieldErrors<'title' | 'why' | 'successSignal'>;
} {
  const title = text(input.title);
  const why = text(input.why);
  const successSignal = text(input.successSignal);
  const value: { title: string; why?: string; successSignal?: string } = { title };
  if (why) value.why = why;
  if (successSignal) value.successSignal = successSignal;
  return {
    value,
    errors: compact({
      title: checkText(title, short, true),
      why: checkText(why, long, false),
      successSignal: checkText(successSignal, long, false),
    }),
  };
}

export interface HabitInput {
  kind: HabitKind;
  goalId?: string;
  actionText: string;
  minimumText?: string;
  cue?: { type: CueType; description?: string; time?: string };
  intention?: Intention;
  copingPlans?: CopingPlan[];
  schedule?: Schedule;
  weight?: number;
}

export interface NormalizedHabitInput {
  kind: HabitKind;
  goalId?: string;
  actionText: string;
  minimumText?: string;
  cue?: Cue;
  intention?: Intention;
  copingPlans: CopingPlan[];
  schedule: Schedule;
  weight: number;
}

export type HabitField = 'actionText' | 'minimumText' | 'cue' | 'intention' | 'copingPlans' | 'schedule' | 'weight';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string | undefined): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/**
 * Prüft und normalisiert ein Habit. Pflicht bei BUILD: Handlung, Auslöser, Minimalversion.
 * Gegen-Habits sind immer täglich und haben keine Minimalversion.
 */
export function normalizeHabitInput(input: HabitInput): { value: NormalizedHabitInput; errors: FieldErrors<HabitField> } {
  const isBuild = input.kind === 'BUILD';
  const actionText = text(input.actionText);
  const minimumText = text(input.minimumText);

  let cue: Cue | undefined;
  let cueError: FieldError | undefined;
  if (input.cue) {
    const description = text(input.cue.description);
    const time = input.cue.time?.trim() || undefined;
    if (input.cue.type === 'TIME') {
      if (!isValidTime(time)) cueError = time ? 'INVALID' : 'REQUIRED';
      else cue = { type: 'TIME', description, time };
    } else {
      cueError = checkText(description, short, true);
      if (!cueError) cue = { type: input.cue.type, description };
    }
    if (!cueError && description.length > short) cueError = 'TOO_LONG';
  } else if (isBuild) {
    cueError = 'REQUIRED';
  }

  let intention: Intention | undefined;
  let intentionError: FieldError | undefined;
  if (input.intention) {
    const ifText = text(input.intention.ifText);
    const thenText = text(input.intention.thenText);
    if (ifText || thenText) {
      if (!ifText || !thenText) intentionError = 'REQUIRED';
      else if (ifText.length > long || thenText.length > long) intentionError = 'TOO_LONG';
      else intention = { ifText, thenText };
    }
  }

  const copingPlans = (input.copingPlans ?? [])
    .map((p) => ({ obstacle: text(p.obstacle), response: text(p.response) }))
    .filter((p) => p.obstacle || p.response);
  let copingError: FieldError | undefined;
  if (copingPlans.length > MAX_COPING_PLANS) copingError = 'TOO_LONG';
  else if (copingPlans.some((p) => !p.obstacle || !p.response)) copingError = 'REQUIRED';
  else if (copingPlans.some((p) => p.obstacle.length > long || p.response.length > long)) copingError = 'TOO_LONG';

  let schedule: Schedule = input.schedule ?? { type: 'DAILY' };
  let scheduleError: FieldError | undefined;
  if (!isBuild) schedule = { type: 'DAILY' };
  else if (!isValidSchedule(schedule)) scheduleError = 'INVALID';
  else if (schedule.type === 'WEEKDAYS') schedule = { type: 'WEEKDAYS', days: normalizeWeekdays(schedule.days) };

  const weight = input.weight ?? scoringConfig.weight.default;
  const weightError =
    Number.isInteger(weight) && weight >= scoringConfig.weight.min && weight <= scoringConfig.weight.max
      ? undefined
      : 'INVALID';

  const value: NormalizedHabitInput = { kind: input.kind, actionText, copingPlans, schedule, weight };
  if (input.goalId) value.goalId = input.goalId;
  if (isBuild && minimumText) value.minimumText = minimumText;
  if (cue) value.cue = cue;
  if (intention) value.intention = intention;

  return {
    value,
    errors: compact({
      actionText: checkText(actionText, short, true),
      minimumText: isBuild ? checkText(minimumText, short, true) : undefined,
      cue: cueError,
      intention: intentionError,
      copingPlans: copingError,
      schedule: scheduleError,
      weight: weightError,
    }),
  };
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/** Zeitangaben wie „nach dem Mittagessen“ werden zu „es nach dem Mittagessen ist“. */
const TIME_PHRASE_STARTERS = new Set([
  'nach', 'vor', 'am', 'um', 'im', 'morgens', 'mittags', 'abends', 'direkt', 'gleich', 'kurz', 'jeden', 'jede',
  'jedes', 'während',
]);
/** „Beim Zähneputzen“ wird zu „ich beim Zähneputzen bin“. */
const PLACE_PHRASE_STARTERS = new Set(['bei', 'beim']);
/** Einleitungen, die im Wenn-Satz entfallen: „Sobald ich heimkomme“ → „ich heimkomme“. */
const DROPPED_CONJUNCTIONS = /^(wenn|sobald|nachdem)\s+/i;

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/**
 * Formt einen Auslöser in einen Nebensatz für „Wenn …“ um. Nomen bleiben groß, unbekannte
 * Formen bleiben unverändert. Der Vorschlag ist immer editierbar.
 */
function toIfClause(description: string): string {
  const stripped = description.replace(DROPPED_CONJUNCTIONS, '');
  const first = stripped.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (TIME_PHRASE_STARTERS.has(first)) return `es ${lowerFirst(stripped)} ist`;
  if (PLACE_PHRASE_STARTERS.has(first)) return `ich ${lowerFirst(stripped)} bin`;
  if (first === 'ich') return lowerFirst(stripped);
  return stripped;
}

/** Schlägt aus Auslöser und Handlung einen Wenn-dann-Satz vor. Der Vorschlag ist editierbar. */
export function suggestIntention(cue: Cue | undefined, actionText: string): Intention | undefined {
  const thenText = actionText.trim();
  if (!cue || !thenText) return undefined;
  let ifText: string;
  if (cue.type === 'TIME' && !cue.description.trim()) ifText = `es ${cue.time ?? ''} Uhr ist`.replace(/\s+/g, ' ');
  else ifText = toIfClause(cue.description.trim());
  if (!ifText) return undefined;
  return { ifText, thenText };
}

export function formatIntention(intention: Intention): string {
  return `Wenn ${intention.ifText}, dann ${intention.thenText}.`;
}

/** „Wenn Regen dazwischenkommt, dann 5 Minuten Treppe.“ */
export function formatCopingPlan(plan: CopingPlan): string {
  return `Wenn ${plan.obstacle} dazwischenkommt, dann ${plan.response}.`;
}
