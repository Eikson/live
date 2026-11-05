import { completeOnboarding } from '../../app/onboarding';
import { appConfig } from '../../domain/app-config';
import {
  formatIntention,
  normalizeGoalInput,
  normalizeHabitInput,
  suggestIntention,
  type FieldError,
  type HabitInput,
} from '../../domain/planning';
import { scoringConfig } from '../../domain/scoring/config';
import type { Cue, CueType, Intention } from '../../domain/types';
import { de } from '../../i18n/de';
import { append, h, setFieldError, uid } from '../dom';
import type { Screen } from '../screen';

const t = de.onboarding;
const TOTAL = 8;
const CUE_TYPES: CueType[] = ['ROUTINE', 'EVENT', 'TIME'];

interface WizardState {
  step: number;
  title: string;
  why: string;
  successSignal: string;
  actionText: string;
  cueType: CueType;
  cueDescription: string;
  cueTime: string;
  minimumText: string;
  /** Erst gesetzt, wenn der Vorschlag bearbeitet wurde. */
  intention?: Intention;
  editingIntention: boolean;
  weight: number;
  saving: boolean;
  saveError?: string;
}

function message(error: FieldError | undefined, max: number = appConfig.textLimits.short): string | undefined {
  if (!error) return undefined;
  if (error === 'REQUIRED') return de.errors.required;
  if (error === 'TOO_LONG') return de.errors.tooLong(max);
  return de.errors.invalid;
}

function cueOf(s: WizardState): HabitInput['cue'] {
  return { type: s.cueType, description: s.cueDescription, ...(s.cueType === 'TIME' ? { time: s.cueTime } : {}) };
}

function habitInput(s: WizardState): HabitInput {
  return {
    kind: 'BUILD',
    actionText: s.actionText,
    minimumText: s.minimumText,
    cue: cueOf(s),
    weight: s.weight,
    schedule: { type: 'DAILY' },
    ...(s.intention ? { intention: s.intention } : {}),
  };
}

function suggestion(s: WizardState): Intention | undefined {
  const cue = normalizeHabitInput(habitInput(s)).value.cue as Cue | undefined;
  return suggestIntention(cue, s.actionText);
}

/** Ein Textfeld mit Label, Hinweis und verknüpfter Fehlermeldung. */
function textField(opts: {
  label: string;
  value: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
  max: number;
  name: string;
  onInput: (value: string) => void;
}) {
  const id = uid(opts.name);
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  const props = {
    id,
    name: opts.name,
    maxlength: opts.max,
    'aria-describedby': describedBy,
    oninput: (e: Event) => opts.onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value),
  };
  const input = opts.multiline ? h('textarea', props) : h('input', { ...props, type: 'text', autocomplete: 'off' });
  input.value = opts.value;
  const error = h('p', { id: errorId, class: 'form-error', hidden: true });
  const label = h('label', { for: id }, opts.label, opts.optional ? h('span', { class: 'muted' }, ` (${de.common.optional})`) : null);
  const field = h('div', { class: 'field' }, label, opts.hint ? h('p', { id: hintId, class: 'hint' }, opts.hint) : null, input, error);
  return { field, input, showError: (msg: string | undefined) => setFieldError(input, error, msg) };
}

export const onboardingScreen: Screen = async ({ ctx, onboardingDone }) => {
  const state: WizardState = {
    step: 1,
    title: '',
    why: '',
    successSignal: '',
    actionText: '',
    cueType: 'ROUTINE',
    cueDescription: '',
    cueTime: '',
    minimumText: '',
    editingIntention: false,
    weight: scoringConfig.weight.default,
    saving: false,
  };
  const root = h('section', { class: 'screen wizard' });

  function go(step: number) {
    state.step = Math.min(TOTAL, Math.max(1, step));
    state.saveError = undefined;
    render();
    root.querySelector<HTMLElement>('h1')?.focus();
  }

  /** Prüft den aktuellen Schritt; gibt das erste fehlerhafte Feld zurück. */
  type Check = () => HTMLElement | undefined;

  function frame(heading: string, body: (Node | null)[], check: Check, submitLabel: string = de.common.next): HTMLElement {
    const form = h('form', {
      class: 'wizard',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const invalid = check();
        if (invalid) {
          invalid.focus();
          return;
        }
        if (state.step < TOTAL) go(state.step + 1);
        else void finish();
      },
    });
    const back =
      state.step > 1
        ? h('button', { type: 'button', class: 'button quiet', onclick: () => go(state.step - 1), disabled: state.saving }, de.common.back)
        : h('span');
    append(form, [
      h('p', { class: 'progress' }, de.common.stepOf(state.step, TOTAL)),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(state.step / TOTAL) * 100}%` })),
      h('h1', { tabindex: '-1' }, heading),
      ...body.filter((n): n is Node => n !== null),
      state.saveError ? h('p', { class: 'form-error', role: 'alert' }, state.saveError) : null,
      h(
        'div',
        { class: 'actions split' },
        back,
        h('button', { type: 'submit', class: 'button primary', disabled: state.saving }, state.saving ? de.common.busy : submitLabel),
      ),
    ]);
    return form;
  }

  function stepWelcome() {
    return frame(t.welcome, [h('p', { class: 'muted' }, t.welcomeIntro)], () => undefined, t.start);
  }

  function goalText(field: 'title' | 'why' | 'successSignal', heading: string, opts: { hint?: string; optional?: boolean }) {
    const max = field === 'title' ? appConfig.textLimits.short : appConfig.textLimits.long;
    const f = textField({
      label: heading,
      value: state[field],
      max,
      name: field,
      multiline: field !== 'title',
      ...opts,
      onInput: (v) => (state[field] = v),
    });
    // Die Überschrift ist die Frage; das Label wiederholt sie für Screenreader nicht doppelt sichtbar.
    f.field.querySelector('label')?.classList.add('visually-hidden');
    return frame(heading, [f.field], () => {
      const msg = message(normalizeGoalInput({ title: state.title, why: state.why, successSignal: state.successSignal }).errors[field], max);
      f.showError(msg);
      return msg ? f.input : undefined;
    });
  }

  function habitText(field: 'actionText' | 'minimumText', heading: string, hint: string) {
    const f = textField({
      label: heading,
      hint,
      value: state[field],
      max: appConfig.textLimits.short,
      name: field,
      onInput: (v) => (state[field] = v),
    });
    f.field.querySelector('label')?.classList.add('visually-hidden');
    return frame(heading, [f.field], () => {
      const msg = message(normalizeHabitInput(habitInput(state)).errors[field]);
      f.showError(msg);
      return msg ? f.input : undefined;
    });
  }

  function stepCue() {
    const radios = CUE_TYPES.map((type) =>
      h(
        'label',
        { class: 'choice' },
        h('input', {
          type: 'radio',
          name: 'cueType',
          value: type,
          checked: state.cueType === type,
          onchange: () => {
            state.cueType = type;
            state.intention = undefined;
            render();
            root.querySelector<HTMLInputElement>(`input[name="cueType"][value="${type}"]`)?.focus();
          },
        }),
        h('span', null, t.cueTypes[type]),
      ),
    );
    const description = textField({
      label: t.cueDescription[state.cueType],
      hint: t.cueExamples[state.cueType],
      optional: state.cueType === 'TIME',
      value: state.cueDescription,
      max: appConfig.textLimits.short,
      name: 'cueDescription',
      onInput: (v) => {
        state.cueDescription = v;
        state.intention = undefined;
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
        state.cueTime = (e.target as HTMLInputElement).value;
        state.intention = undefined;
      },
    });
    time.value = state.cueTime;
    const timeField =
      state.cueType === 'TIME' ? h('div', { class: 'field' }, h('label', { for: timeId }, t.cueTime), time, timeError) : null;

    return frame(
      t.cueTitle,
      [
        h('fieldset', null, h('legend', null, t.cueTypeLabel), h('div', { class: 'choices' }, radios)),
        timeField,
        description.field,
        h('p', { class: 'hint' }, t.rhythmNote),
      ],
      () => {
        const err = normalizeHabitInput(habitInput(state)).errors.cue;
        if (state.cueType === 'TIME') {
          const timeMsg = err === 'INVALID' || (err === 'REQUIRED' && !state.cueTime) ? (err === 'INVALID' ? de.errors.invalidTime : de.errors.required) : undefined;
          setFieldError(time, timeError, timeMsg);
          const descMsg = !timeMsg ? message(err) : undefined;
          description.showError(descMsg);
          return timeMsg ? time : descMsg ? description.input : undefined;
        }
        const msg = message(err);
        description.showError(msg);
        return msg ? description.input : undefined;
      },
    );
  }

  function stepPlan() {
    const proposal = state.intention ?? suggestion(state);
    const body: (Node | null)[] = [];

    let ifField: ReturnType<typeof textField> | undefined;
    let thenField: ReturnType<typeof textField> | undefined;
    if (state.editingIntention || !proposal) {
      const current = proposal ?? { ifText: '', thenText: state.actionText.trim() };
      state.intention = current;
      ifField = textField({
        label: t.planIf,
        value: current.ifText,
        max: appConfig.textLimits.long,
        name: 'ifText',
        onInput: (v) => (state.intention = { ...state.intention!, ifText: v }),
      });
      thenField = textField({
        label: t.planThen,
        value: current.thenText,
        max: appConfig.textLimits.long,
        name: 'thenText',
        onInput: (v) => (state.intention = { ...state.intention!, thenText: v }),
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
                state.intention = proposal;
                state.editingIntention = true;
                render();
                root.querySelector<HTMLElement>('input[name="ifText"]')?.focus();
              },
            },
            t.planEdit,
          ),
        ),
      );
    }
    body.push(h('p', { class: 'muted' }, de.today.minimum(state.minimumText.trim())));

    const weights = [1, 2, 3].map((w) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name: 'weight', value: w, checked: state.weight === w, onchange: () => (state.weight = w) }),
        h('span', null, t.weights[w] ?? String(w)),
      ),
    );
    body.push(h('fieldset', null, h('legend', null, t.weightLabel), h('div', { class: 'choices' }, weights)));

    return frame(
      t.planTitle,
      body,
      () => {
        if (!ifField || !thenField || !state.intention) return undefined;
        const ifMsg = state.intention.ifText.trim() ? undefined : de.errors.required;
        const thenMsg = state.intention.thenText.trim() ? undefined : de.errors.required;
        const tooLong = message(normalizeHabitInput(habitInput(state)).errors.intention, appConfig.textLimits.long);
        ifField.showError(ifMsg ?? (tooLong && !thenMsg ? tooLong : undefined));
        thenField.showError(thenMsg);
        if (ifMsg || (tooLong && !thenMsg)) return ifField.input;
        return thenMsg ? thenField.input : undefined;
      },
      t.finish,
    );
  }

  async function finish() {
    if (state.saving) return;
    const intention = state.intention ?? suggestion(state);
    state.saving = true;
    render();
    try {
      const result = await completeOnboarding(ctx, {
        goal: { title: state.title, why: state.why, successSignal: state.successSignal },
        habit: {
          actionText: state.actionText,
          minimumText: state.minimumText,
          cue: cueOf(state),
          schedule: { type: 'DAILY' },
          weight: state.weight,
          ...(intention ? { intention } : {}),
        },
      });
      state.saving = false;
      if (result.ok) {
        onboardingDone();
        return;
      }
      // Sollte durch die Prüfung je Schritt nicht vorkommen; zurück zum ersten betroffenen Schritt.
      const target = result.goalErrors.title
        ? 2
        : result.goalErrors.why
          ? 3
          : result.goalErrors.successSignal
            ? 4
            : result.habitErrors.actionText
              ? 5
              : result.habitErrors.cue
                ? 6
                : result.habitErrors.minimumText
                  ? 7
                  : 8;
      go(target);
    } catch {
      state.saving = false;
      state.saveError = de.errors.saveFailed;
      render();
    }
  }

  function render() {
    let view: HTMLElement;
    switch (state.step) {
      case 1:
        view = stepWelcome();
        break;
      case 2:
        view = goalText('title', t.goalTitle, { hint: t.goalHint });
        break;
      case 3:
        view = goalText('why', t.whyTitle, { optional: true, hint: t.optionalHint });
        break;
      case 4:
        view = goalText('successSignal', t.successTitle, { optional: true, hint: t.optionalHint });
        break;
      case 5:
        view = habitText('actionText', t.actionTitle, t.actionHint);
        break;
      case 6:
        view = stepCue();
        break;
      case 7:
        view = habitText('minimumText', t.minimumTitle, t.minimumHint);
        break;
      default:
        view = stepPlan();
    }
    root.replaceChildren(view);
  }

  render();
  return root;
};
