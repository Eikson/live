import { appConfig } from '../domain/app-config';
import type { Weekday } from '../domain/local-date';
import {
  formatIntention,
  MAX_COPING_PLANS,
  normalizeGoalInput,
  normalizeHabitInput,
  suggestIntention,
  type GoalInput,
  type HabitInput,
} from '../domain/planning';
import { scoringConfig } from '../domain/scoring/config';
import type { CopingPlan, Cue, CueType, Intention, Schedule } from '../domain/types';
import { de } from '../i18n/de';
import { h, setFieldError, uid } from './dom';
import { WEEK_ORDER } from './format';
import { message, textField, type TextField, type Wizard } from './wizard';

/**
 * Schritte für Ziele und Gewohnheiten, gemeinsam genutzt vom ersten Start und von
 * „+ Ziel“ / „+ Gewohnheit“ im Plan.
 */

const t = de.onboarding;
const CUE_TYPES: CueType[] = ['ROUTINE', 'EVENT', 'TIME'];

export interface GoalDraft {
  title: string;
  why: string;
  successSignal: string;
}

export function emptyGoalDraft(): GoalDraft {
  return { title: '', why: '', successSignal: '' };
}

export function goalInputOf(d: GoalDraft): GoalInput {
  return { title: d.title, why: d.why, successSignal: d.successSignal };
}

/** Ein Ziel-Schritt: Titel (Pflicht), Warum oder Erfolgszeichen (optional). */
export function goalTextStep(
  w: Wizard,
  d: GoalDraft,
  field: keyof GoalDraft,
  heading: string,
  opts: { hint?: string; optional?: boolean; context?: string },
  submitLabel?: string,
): HTMLElement {
  const max = field === 'title' ? appConfig.textLimits.short : appConfig.textLimits.long;
  const f = textField({
    label: heading,
    hiddenLabel: true,
    value: d[field],
    max,
    name: field,
    multiline: field !== 'title',
    ...opts,
    onInput: (v) => (d[field] = v),
  });
  return w.frame(
    heading,
    [opts.context ? h('p', { class: 'muted' }, opts.context) : null, f.field],
    () => {
      const msg = message(normalizeGoalInput(goalInputOf(d)).errors[field], max);
      f.showError(msg);
      return msg ? f.input : undefined;
    },
    submitLabel,
  );
}

export interface HabitDraft {
  actionText: string;
  cueType: CueType;
  cueDescription: string;
  cueTime: string;
  scheduleType: Schedule['type'];
  days: Weekday[];
  minimumText: string;
  /** Erst gesetzt, wenn der Vorschlag bearbeitet wurde. */
  intention?: Intention;
  editingIntention: boolean;
  copingPlans: CopingPlan[];
  weight: number;
}

export function emptyHabitDraft(): HabitDraft {
  return {
    actionText: '',
    cueType: 'ROUTINE',
    cueDescription: '',
    cueTime: '',
    scheduleType: 'DAILY',
    days: [],
    minimumText: '',
    editingIntention: false,
    copingPlans: [],
    weight: scoringConfig.weight.default,
  };
}

function cueOf(d: HabitDraft): HabitInput['cue'] {
  return { type: d.cueType, description: d.cueDescription, ...(d.cueType === 'TIME' ? { time: d.cueTime } : {}) };
}

function scheduleOf(d: HabitDraft): Schedule {
  return d.scheduleType === 'DAILY' ? { type: 'DAILY' } : { type: 'WEEKDAYS', days: d.days };
}

/** Eingaben wie im Formular; der Wenn-dann-Satz nur, wenn er bearbeitet wurde. */
function rawInput(d: HabitDraft): HabitInput {
  return {
    kind: 'BUILD',
    actionText: d.actionText,
    minimumText: d.minimumText,
    cue: cueOf(d),
    schedule: scheduleOf(d),
    copingPlans: d.copingPlans,
    weight: d.weight,
    ...(d.intention ? { intention: d.intention } : {}),
  };
}

function suggestion(d: HabitDraft): Intention | undefined {
  const cue = normalizeHabitInput(rawInput(d)).value.cue as Cue | undefined;
  return suggestIntention(cue, d.actionText);
}

/** Was gespeichert wird: ohne eigene Änderung gilt der Vorschlag. */
export function habitInputOf(d: HabitDraft): Omit<HabitInput, 'kind' | 'goalId'> {
  const intention = d.intention ?? suggestion(d);
  return {
    actionText: d.actionText,
    minimumText: d.minimumText,
    cue: cueOf(d),
    schedule: scheduleOf(d),
    copingPlans: d.copingPlans,
    weight: d.weight,
    ...(intention ? { intention } : {}),
  };
}

/** Handlung oder Minimalversion. */
export function habitTextStep(
  w: Wizard,
  d: HabitDraft,
  field: 'actionText' | 'minimumText',
  heading: string,
  hint: string,
  context?: string,
): HTMLElement {
  const f = textField({
    label: heading,
    hiddenLabel: true,
    hint,
    value: d[field],
    max: appConfig.textLimits.short,
    name: field,
    onInput: (v) => (d[field] = v),
  });
  return w.frame(heading, [context ? h('p', { class: 'muted' }, context) : null, f.field], () => {
    const msg = message(normalizeHabitInput(rawInput(d)).errors[field]);
    f.showError(msg);
    return msg ? f.input : undefined;
  });
}

function radio(name: string, value: string, label: string, checked: boolean, onchange: () => void): HTMLElement {
  return h(
    'label',
    { class: 'choice' },
    h('input', { type: 'radio', name, value, checked, onchange }),
    h('span', null, label),
  );
}

/** Auslöser (Routine, Ereignis, Uhrzeit – die Uhrzeit ist nie Pflicht) und Rhythmus. */
export function cueStep(w: Wizard, d: HabitDraft): HTMLElement {
  const rerenderFocus = (selector: string) => {
    w.render();
    w.root.querySelector<HTMLInputElement>(selector)?.focus();
  };
  const cueRadios = CUE_TYPES.map((type) =>
    radio('cueType', type, t.cueTypes[type], d.cueType === type, () => {
      d.cueType = type;
      d.intention = undefined;
      rerenderFocus(`input[name="cueType"][value="${type}"]`);
    }),
  );
  const description = textField({
    label: t.cueDescription[d.cueType],
    hint: t.cueExamples[d.cueType],
    optional: d.cueType === 'TIME',
    value: d.cueDescription,
    max: appConfig.textLimits.short,
    name: 'cueDescription',
    onInput: (v) => {
      d.cueDescription = v;
      d.intention = undefined;
    },
  });
  const timeId = uid('time');
  const timeError = h('p', { id: `${timeId}-error`, class: 'form-error', hidden: true });
  const time = h('input', {
    id: timeId,
    type: 'time',
    name: 'cueTime',
    'aria-describedby': `${timeId}-error`,
    oninput: (e) => {
      d.cueTime = (e.target as HTMLInputElement).value;
      d.intention = undefined;
    },
  });
  time.value = d.cueTime;
  const timeField =
    d.cueType === 'TIME' ? h('div', { class: 'field' }, h('label', { for: timeId }, t.cueTime), time, timeError) : null;

  const rhythmRadios = (['DAILY', 'WEEKDAYS'] as const).map((type) =>
    radio('scheduleType', type, t.rhythm[type], d.scheduleType === type, () => {
      d.scheduleType = type;
      rerenderFocus(`input[name="scheduleType"][value="${type}"]`);
    }),
  );
  const daysErrorId = uid('days-error');
  const daysError = h('p', { id: daysErrorId, class: 'form-error', hidden: true });
  const dayBoxes = WEEK_ORDER.map((day) =>
    h('input', {
      type: 'checkbox',
      name: 'days',
      value: day,
      checked: d.days.includes(day),
      'aria-label': de.date.weekdaysLong[day],
      'aria-describedby': daysErrorId,
      onchange: (e) => {
        const on = (e.target as HTMLInputElement).checked;
        d.days = on ? [...d.days, day] : d.days.filter((x) => x !== day);
      },
    }),
  );
  const daysField =
    d.scheduleType === 'WEEKDAYS'
      ? h(
          'fieldset',
          { class: 'weekdays' },
          h('legend', null, t.weekdaysLabel),
          h(
            'div',
            { class: 'weekday-choices' },
            WEEK_ORDER.map((day, i) =>
              h(
                'label',
                { class: 'weekday' },
                dayBoxes[i] ?? null,
                h('span', { 'aria-hidden': 'true' }, de.date.weekdaysShort[day] ?? ''),
              ),
            ),
          ),
          daysError,
        )
      : null;

  return w.frame(
    t.cueTitle,
    [
      h('fieldset', null, h('legend', null, t.cueTypeLabel), h('div', { class: 'choices' }, cueRadios)),
      timeField,
      description.field,
      h('fieldset', null, h('legend', null, t.rhythmLabel), h('div', { class: 'choices' }, rhythmRadios)),
      daysField,
    ],
    () => {
      const errors = normalizeHabitInput(rawInput(d)).errors;
      const err = errors.cue;
      let first: HTMLElement | undefined;
      if (d.cueType === 'TIME') {
        const timeMsg = err === 'INVALID' ? de.errors.invalidTime : err === 'REQUIRED' && !d.cueTime ? de.errors.required : undefined;
        setFieldError(time, timeError, timeMsg);
        const descMsg = !timeMsg ? message(err) : undefined;
        description.showError(descMsg);
        first = timeMsg ? time : descMsg ? description.input : undefined;
      } else {
        const msg = message(err);
        description.showError(msg);
        first = msg ? description.input : undefined;
      }
      if (d.scheduleType === 'WEEKDAYS') {
        const daysMsg = errors.schedule ? t.weekdaysRequired : undefined;
        daysError.hidden = !daysMsg;
        daysError.textContent = daysMsg ?? '';
        for (const box of dayBoxes) {
          if (daysMsg) box.setAttribute('aria-invalid', 'true');
          else box.removeAttribute('aria-invalid');
        }
        first ??= daysMsg ? dayBoxes[0] : undefined;
      }
      return first;
    },
  );
}

/** Wenn-dann-Satz (Vorschlag, editierbar), optionale Hindernispläne und Gewicht. */
export function planStep(w: Wizard, d: HabitDraft, opts: { submitLabel: string; note?: string }): HTMLElement {
  const proposal = d.intention ?? suggestion(d);
  const body: (Node | null)[] = [];

  let ifField: TextField | undefined;
  let thenField: TextField | undefined;
  if (d.editingIntention || !proposal) {
    const current = proposal ?? { ifText: '', thenText: d.actionText.trim() };
    d.intention = current;
    ifField = textField({
      label: t.planIf,
      value: current.ifText,
      max: appConfig.textLimits.long,
      name: 'ifText',
      onInput: (v) => (d.intention = { ...d.intention!, ifText: v }),
    });
    thenField = textField({
      label: t.planThen,
      value: current.thenText,
      max: appConfig.textLimits.long,
      name: 'thenText',
      onInput: (v) => (d.intention = { ...d.intention!, thenText: v }),
    });
    body.push(h('div', { class: 'card wizard' }, ifField.field, thenField.field));
  } else {
    body.push(
      h(
        'div',
        { class: 'card' },
        h('p', { class: 'plan-sentence', 'data-role': 'plan-sentence' }, formatIntention(proposal)),
        h(
          'button',
          {
            type: 'button',
            class: 'button link',
            onclick: () => {
              d.intention = proposal;
              d.editingIntention = true;
              w.render();
              w.root.querySelector<HTMLElement>('input[name="ifText"]')?.focus();
            },
          },
          t.planEdit,
        ),
      ),
    );
  }
  body.push(h('p', { class: 'muted' }, de.today.minimum(d.minimumText.trim())));

  // Hindernispläne: leere Zeilen werden ignoriert, halb ausgefüllte gemeldet.
  const copingFields = d.copingPlans.map((plan, i) => {
    const obstacle = textField({
      label: t.copingObstacle,
      value: plan.obstacle,
      max: appConfig.textLimits.long,
      name: `obstacle-${i}`,
      onInput: (v) => (d.copingPlans[i] = { ...d.copingPlans[i]!, obstacle: v }),
    });
    const response = textField({
      label: t.copingResponse,
      value: plan.response,
      max: appConfig.textLimits.long,
      name: `response-${i}`,
      onInput: (v) => (d.copingPlans[i] = { ...d.copingPlans[i]!, response: v }),
    });
    const remove = h(
      'button',
      {
        type: 'button',
        class: 'button link',
        onclick: () => {
          d.copingPlans.splice(i, 1);
          w.render();
          w.root.querySelector<HTMLElement>('[data-role="coping-add"]')?.focus();
        },
      },
      t.copingRemove,
      h('span', { class: 'visually-hidden' }, `: ${t.copingItem(i + 1)}`),
    );
    const row = h('fieldset', { class: 'coping', 'data-role': 'coping' }, h('legend', null, t.copingItem(i + 1)), obstacle.field, response.field, remove);
    return { row, obstacle, response };
  });
  const add =
    d.copingPlans.length < MAX_COPING_PLANS
      ? h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            'data-role': 'coping-add',
            onclick: () => {
              d.copingPlans.push({ obstacle: '', response: '' });
              w.render();
              w.root.querySelector<HTMLElement>(`input[name="obstacle-${d.copingPlans.length - 1}"]`)?.focus();
            },
          },
          t.copingAdd,
        )
      : null;
  const copingTitleId = uid('coping-title');
  body.push(
    h(
      'section',
      { class: 'coping-plans', 'aria-labelledby': copingTitleId },
      h('h2', { id: copingTitleId }, t.copingTitle, h('span', { class: 'muted' }, ` (${de.common.optional})`)),
      h('p', { class: 'hint' }, t.copingHint),
      copingFields.map((c) => c.row),
      add,
    ),
  );

  const weights = [1, 2, 3].map((value) =>
    radio('weight', String(value), t.weights[value] ?? String(value), d.weight === value, () => (d.weight = value)),
  );
  body.push(h('fieldset', null, h('legend', null, t.weightLabel), h('div', { class: 'choices' }, weights)));
  if (opts.note) body.push(h('p', { class: 'card notice', 'data-role': 'draft-note' }, opts.note));

  return w.frame(
    t.planTitle,
    body,
    () => {
      let first: HTMLElement | undefined;
      if (ifField && thenField && d.intention) {
        const ifMsg = d.intention.ifText.trim() ? undefined : de.errors.required;
        const thenMsg = d.intention.thenText.trim() ? undefined : de.errors.required;
        const tooLong = message(normalizeHabitInput(rawInput(d)).errors.intention, appConfig.textLimits.long);
        ifField.showError(ifMsg ?? (tooLong && !thenMsg ? tooLong : undefined));
        thenField.showError(thenMsg);
        if (ifMsg || (tooLong && !thenMsg)) first = ifField.input;
        else if (thenMsg) first = thenField.input;
      }
      for (const { obstacle, response } of copingFields) {
        const o = obstacle.input.value.trim();
        const r = response.input.value.trim();
        const oMsg = !o && r ? de.errors.required : undefined;
        const rMsg = o && !r ? de.errors.required : undefined;
        obstacle.showError(oMsg);
        response.showError(rMsg);
        first ??= oMsg ? obstacle.input : rMsg ? response.input : undefined;
      }
      return first;
    },
    opts.submitLabel,
  );
}
