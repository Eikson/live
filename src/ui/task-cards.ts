import type { AppContext } from '../app/context';
import { answerLateStart, deferTask, finishTask, markReviewDone, startTask, type TaskItem } from '../app/tasks';
import { appConfig } from '../domain/app-config';
import { addDays, type LocalDate } from '../domain/local-date';
import { AVERSION_REASONS, LATE_START_CHOICES } from '../domain/task';
import type { AversionReason, LateStartChoice } from '../domain/types';
import { de } from '../i18n/de';
import { h, uid } from './dom';
import { formatDayShort } from './format';
import { toggleGroup } from './toggles';

const t = de.tasks.card;

type Mode = 'idle' | 'start' | 'defer' | 'finish';

/**
 * Karte eines Vorhabens auf „Heute“. Ist der geplante Start erreicht, führt sie durch den Start:
 * benennen, was unangenehm ist, den Schritt bestätigen oder verkleinern, „Angefangen“. Bewusstes
 * Verschieben verlangt einen Grund. Läuft das Vorhaben, bietet sie Review und Abschluss an.
 * Nach jeder gespeicherten Aktion lädt `refresh` die Seite neu und zeigt die Meldung.
 */
export function taskCard(ctx: AppContext, item: TaskItem, today: LocalDate, refresh: (status: string) => void): HTMLElement {
  const { task } = item;
  const titleId = uid('task');
  const article = h('article', { class: 'card task-card', 'aria-labelledby': titleId, 'data-task': task.id, 'data-phase': item.phase });
  let mode: Mode = 'idle';
  let busy = false;
  let error: string | undefined;
  let focus: string | undefined;

  // Eingaben der aufgeklappten Formulare
  let reason: AversionReason | null = null;
  let aversion: number | null = null;
  let step = task.firstStep;
  let deferTo = addDays(today, 1) <= task.deadline ? addDays(today, 1) : task.deadline;
  let deferReason = '';
  let minutes = '';

  /** Führt eine Speicherung aus; liefert sie einen Text, ist es die Fehlermeldung. */
  async function run(action: () => Promise<string | undefined>, done: string | (() => string)): Promise<void> {
    if (busy) return;
    busy = true;
    error = undefined;
    render();
    let failure: string | undefined;
    try {
      failure = await action();
    } catch {
      failure = de.errors.saveFailed;
    }
    busy = false;
    if (failure === undefined) {
      refresh(typeof done === 'function' ? done() : done);
      return;
    }
    error = failure;
    render();
  }

  function open(next: Mode, focusRole: string): void {
    mode = next;
    error = undefined;
    focus = focusRole;
    render();
  }

  const cancel = () => h('button', { type: 'button', class: 'button quiet', disabled: busy, onclick: () => open('idle', 'first') }, de.common.cancel);

  function startForm(): HTMLElement {
    const reasonId = uid('reason');
    const aversionId = uid('aversion');
    const stepId = uid('step');
    const stepInput = h('input', {
      id: stepId,
      type: 'text',
      name: 'firstStep',
      autocomplete: 'off',
      maxlength: appConfig.textLimits.long,
      'aria-describedby': `${stepId}-hint`,
      oninput: (e) => (step = (e.target as HTMLInputElement).value),
    });
    stepInput.value = step;
    return h(
      'form',
      {
        class: 'task-form',
        'data-role': 'start-form',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (!step.trim()) {
            error = de.errors.required;
            focus = 'step';
            render();
            return;
          }
          void run(async () => {
            const r = await startTask(ctx, task.id, { reason, aversion, firstStep: step });
            return r.ok ? undefined : de.errors.saveFailed;
          }, t.startedMessage);
        },
      },
      h('p', { class: 'evening-item__title', id: reasonId, tabindex: '-1', 'data-role': 'start-question' }, t.reasonQuestion),
      toggleGroup<AversionReason>({
        labelledBy: reasonId,
        options: AVERSION_REASONS.map((value) => ({ value, label: t.reasons[value]! })),
        get: () => reason,
        set: (v) => (reason = v),
        clearable: true,
        className: 'chips',
        key: 'reason',
      }),
      h('p', { class: 'evening-item__title', id: aversionId }, t.aversionQuestion),
      toggleGroup<number>({
        labelledBy: aversionId,
        options: [0, 1, 2, 3, 4].map((value) => ({ value, label: String(value) })),
        get: () => aversion,
        set: (v) => (aversion = v),
        clearable: true,
        className: 'rating',
        key: 'aversion',
      }),
      h('p', { class: 'hint' }, t.aversionScale),
      h(
        'div',
        { class: 'field' },
        h('label', { for: stepId }, t.stepLabel),
        h('p', { class: 'hint', id: `${stepId}-hint` }, t.stepHint),
        stepInput,
      ),
      h('p', { class: 'task-note' }, t.startNote),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'button primary', disabled: busy, 'data-action': 'started' }, t.started), cancel()),
    );
  }

  function deferForm(): HTMLElement {
    const dateId = uid('defer-date');
    const reasonId = uid('defer-reason');
    const dateInput = h('input', {
      id: dateId,
      type: 'date',
      name: 'deferTo',
      min: today,
      max: task.deadline,
      oninput: (e) => (deferTo = (e.target as HTMLInputElement).value),
    });
    dateInput.value = deferTo;
    const reasonInput = h('input', {
      id: reasonId,
      type: 'text',
      name: 'deferReason',
      autocomplete: 'off',
      maxlength: appConfig.textLimits.short,
      'aria-describedby': `${reasonId}-hint`,
      oninput: (e) => (deferReason = (e.target as HTMLInputElement).value),
    });
    reasonInput.value = deferReason;
    return h(
      'form',
      {
        class: 'task-form',
        'data-role': 'defer-form',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const to = deferTo;
          void run(async () => {
            const r = await deferTask(ctx, task.id, to, deferReason);
            if (r.ok) return undefined;
            focus = r.reason === 'DATE_INVALID' ? 'defer-date' : 'defer-reason';
            return t.deferErrors[r.reason] ?? de.errors.saveFailed;
          }, t.deferred(formatDayShort(to)));
        },
      },
      h('p', { class: 'hint' }, t.deferIntro),
      h('div', { class: 'field' }, h('label', { for: dateId }, t.deferTo), dateInput),
      h(
        'div',
        { class: 'field' },
        h('label', { for: reasonId }, t.deferReason),
        h('p', { class: 'hint', id: `${reasonId}-hint` }, t.deferReasonHint),
        reasonInput,
      ),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'button primary', disabled: busy }, t.deferSave), cancel()),
    );
  }

  function finishForm(): HTMLElement {
    const id = uid('minutes');
    const input = h('input', {
      id,
      type: 'number',
      name: 'actualMinutes',
      min: 1,
      max: appConfig.tasks.maxMinutes,
      step: 1,
      inputmode: 'numeric',
      oninput: (e) => (minutes = (e.target as HTMLInputElement).value),
    });
    input.value = minutes;
    return h(
      'form',
      {
        class: 'task-form',
        'data-role': 'finish-form',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          let buffer = 0;
          // Der Text der Meldung steht erst nach dem Speichern fest.
          void run(
            async () => {
              const r = await finishTask(ctx, task.id, minutes);
              if (r.ok) {
                buffer = r.buffer;
                return undefined;
              }
              focus = 'minutes';
              return r.reason === 'MINUTES_INVALID' ? t.actualMinutesInvalid : de.errors.saveFailed;
            },
            () => t.finished(buffer),
          );
        },
      },
      h(
        'div',
        { class: 'field' },
        h('label', { for: id }, t.actualMinutes, h('span', { class: 'muted' }, ` (${de.common.optional})`)),
        input,
      ),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'button primary', disabled: busy }, t.finishSave), cancel()),
    );
  }

  function lateQuestion(): HTMLElement {
    const id = uid('late');
    const choose = (choice: LateStartChoice) =>
      void run(async () => ((await answerLateStart(ctx, task.id, choice)).ok ? undefined : de.errors.saveFailed), t.lateSaved);
    return h(
      'div',
      { class: 'task-form', 'data-role': 'late-question' },
      h('p', { class: 'evening-item__title', id }, t.lateQuestion),
      h(
        'div',
        { class: 'actions', role: 'group', 'aria-labelledby': id },
        LATE_START_CHOICES.map((choice) =>
          h('button', { type: 'button', class: 'button', disabled: busy, 'data-choice': choice, onclick: () => choose(choice) }, t.lateChoices[choice]!),
        ),
        h('button', { type: 'button', class: 'button link', disabled: busy, 'data-choice': 'SKIPPED', onclick: () => choose('SKIPPED') }, t.lateSkip),
      ),
    );
  }

  function reviewLine(): HTMLElement | null {
    if (task.reviewOn === undefined) return null;
    if (task.reviewDoneOn !== undefined) return h('p', { class: 'detail muted' }, t.reviewGot(formatDayShort(task.reviewDoneOn)));
    return h(
      'p',
      { class: 'detail review-line' },
      h('span', null, t.reviewUntil(formatDayShort(task.reviewOn))),
      ' ',
      h(
        'button',
        {
          type: 'button',
          class: 'button link',
          disabled: busy,
          'data-action': 'review-done',
          onclick: () => void run(async () => ((await markReviewDone(ctx, task.id)).ok ? undefined : de.errors.saveFailed), t.reviewDoneMessage),
        },
        t.reviewDone,
      ),
    );
  }

  function render(): void {
    const due = item.phase === 'DUE';
    const label = due
      ? item.waitingDays === 0
        ? t.labelDueToday
        : t.labelDueSince(formatDayShort(task.plannedStart))
      : t.labelRunning;
    const children: (Node | null)[] = [
      h('p', { class: 'label', 'data-role': 'card-label' }, label),
      h('h2', { id: titleId }, task.title),
      mode === 'start' ? null : h('p', { class: 'detail' }, t.step(task.firstStep)),
      h('p', { class: 'detail muted' }, t.deadline(item.daysToDeadline, formatDayShort(task.deadline))),
    ];
    if (due) {
      if (mode === 'start') children.push(startForm());
      else if (mode === 'defer') children.push(deferForm());
      else {
        children.push(
          h(
            'div',
            { class: 'actions' },
            h('button', { type: 'button', class: 'button primary', 'data-action': 'begin', onclick: () => open('start', 'start-question') }, t.begin),
            h('button', { type: 'button', class: 'button', 'data-action': 'defer', onclick: () => open('defer', 'defer-date') }, t.defer),
          ),
        );
      }
    } else {
      children.push(reviewLine());
      if (item.lateQuestion && mode === 'idle') children.push(lateQuestion());
      if (mode === 'finish') children.push(finishForm());
      else {
        children.push(
          h(
            'div',
            { class: 'actions' },
            h('button', { type: 'button', class: 'button', disabled: busy, 'data-action': 'finish', onclick: () => open('finish', 'minutes') }, t.finish),
          ),
        );
      }
    }
    children.push(
      h('p', { class: error ? 'form-error' : 'status-line', role: error ? 'alert' : 'status', 'data-role': 'task-status' }, error ?? (busy ? de.common.busy : '')),
    );
    article.replaceChildren(...children.filter((c): c is Node => c !== null));

    const target = focus;
    focus = undefined;
    const selector: Record<string, string> = {
      first: '.actions button',
      'start-question': '[data-role="start-question"]',
      step: 'input[name="firstStep"]',
      'defer-date': 'input[name="deferTo"]',
      'defer-reason': 'input[name="deferReason"]',
      minutes: 'input[name="actualMinutes"]',
    };
    if (target && selector[target]) article.querySelector<HTMLElement>(selector[target])?.focus();
  }

  render();
  return article;
}
