import { addAvoidanceItem } from '../../app/counter-habits';
import { clearException, closeDay, loadEveningView, setException, type EveningView } from '../../app/evening';
import { appConfig } from '../../domain/app-config';
import { EXCEPTION_REASONS, RATING_VALUES } from '../../domain/evening';
import { isLocalDate, type LocalDate } from '../../domain/local-date';
import type { CheckInOutcome, ExceptionReason } from '../../domain/types';
import { de } from '../../i18n/de';
import { dayPicker } from '../day-picker';
import { h, uid } from '../dom';
import { formatDayShort } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const t = de.evening;

/** Eingaben des Abends; gespeichert wird erst mit „Tag abschließen“ (eine Transaktion). */
interface Draft {
  mood: number | null;
  energy: number | null;
  answers: Map<string, CheckInOutcome>;
  avoidance: Set<string>;
}

function draftOf(view: EveningView): Draft {
  const answers = new Map<string, CheckInOutcome>();
  for (const e of [view.procrastination, ...view.customs]) {
    if (e?.checkIn) answers.set(e.habit.id, e.checkIn.outcome);
  }
  return {
    mood: view.record?.mood ?? null,
    energy: view.record?.energy ?? null,
    answers,
    avoidance: new Set(view.avoidance?.checkIn?.avoidanceItemIds ?? []),
  };
}

interface Option<T> {
  value: T;
  label: string;
}

/**
 * Knopfgruppe mit `aria-pressed`. Ein zweiter Tipp nimmt die Wahl zurück, solange `clearable` gilt.
 * Die Knöpfe werden an Ort und Stelle aktualisiert, damit der Fokus bleibt.
 */
function toggleGroup<T>(opts: {
  labelledBy: string;
  options: Option<T>[];
  get: () => T | null | undefined;
  set: (value: T | null) => void;
  clearable: boolean;
  className?: string;
  key: string;
}): HTMLElement {
  const group = h('div', { class: `actions toggles${opts.className ? ` ${opts.className}` : ''}`, role: 'group', 'aria-labelledby': opts.labelledBy });
  const buttons = opts.options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'button toggle',
        'data-key': opts.key,
        'data-value': String(o.value),
        onclick: () => {
          const current = opts.get();
          if (current === o.value) {
            if (opts.clearable) opts.set(null);
          } else {
            opts.set(o.value);
          }
          sync();
        },
      },
      o.label,
    ),
  );
  const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(opts.get() === opts.options[i]!.value)));
  sync();
  group.append(...buttons);
  return group;
}

/** Eine Frage mit Antwortknöpfen; Name der Frage als Beschriftung der Gruppe. */
function question(title: string, group: (labelId: string) => HTMLElement, extra: (Node | null)[] = []): HTMLElement {
  const id = uid('q');
  return h('div', { class: 'evening-item' }, h('p', { class: 'evening-item__title', id }, title), group(id), ...extra.filter((n): n is Node => n !== null));
}

export const eveningScreen: Screen = async ({ ctx, params }) => {
  const section = h('section', { class: 'screen evening' });
  const requested = params.get('tag');
  let view = await loadEveningView(ctx, isLocalDate(requested) ? requested : undefined);
  let draft = draftOf(view);
  let busy = false;
  let status: { text: string; error?: boolean } | undefined;
  let exceptionOpen = false;
  let exception: { reason: ExceptionReason; note: string } = { reason: 'SICK', note: '' };
  let adding = false;
  let addText = '';
  let addError: string | undefined;

  async function reload(day: LocalDate, keepDraft: boolean): Promise<void> {
    view = await loadEveningView(ctx, day);
    if (!keepDraft) draft = draftOf(view);
  }

  /** Führt eine Speicherung aus; Fehler erscheinen ruhig in der Statuszeile. */
  async function run(
    action: () => Promise<string | undefined>,
    focus: () => string = () => '[data-role="evening-status"]',
  ): Promise<void> {
    if (busy) return;
    busy = true;
    status = undefined;
    render();
    try {
      const text = await action();
      status = text ? { text } : status;
    } catch {
      status = { text: de.errors.saveFailed, error: true };
    }
    busy = false;
    render();
    section.querySelector<HTMLElement>(focus())?.focus();
  }

  function ratings(): HTMLElement {
    const options = RATING_VALUES.map((v) => ({ value: v as number, label: String(v) }));
    const row = (label: string, key: 'mood' | 'energy') =>
      question(label, (id) =>
        toggleGroup({
          labelledBy: id,
          options,
          get: () => draft[key],
          set: (v) => (draft[key] = v),
          clearable: true,
          className: 'rating',
          key,
        }),
      );
    return h(
      'div',
      { class: 'card evening-block' },
      row(t.mood, 'mood'),
      row(t.energy, 'energy'),
      h('p', { class: 'hint' }, `${t.ratingLow} · ${t.ratingHigh}. ${t.ratingHint}`),
    );
  }

  function answerGroup(habitId: string, title: string, labels: Record<string, string>, stored: boolean): HTMLElement {
    return question(title, (id) =>
      toggleGroup({
        labelledBy: id,
        options: Object.entries(labels).map(([value, label]) => ({ value: value as CheckInOutcome, label })),
        get: () => draft.answers.get(habitId),
        set: (v) => (v === null ? draft.answers.delete(habitId) : draft.answers.set(habitId, v)),
        // Eine gespeicherte Antwort lässt sich ändern, aber nicht leeren.
        clearable: !stored,
        key: habitId,
      }),
    );
  }

  function avoidanceBlock(avoidance: NonNullable<EveningView['avoidance']>): HTMLElement {
    const titleId = uid('avoid');
    const chips = h(
      'div',
      { class: 'actions chips', role: 'group', 'aria-labelledby': titleId },
      avoidance.items.map((item) => {
        const button = h(
          'button',
          {
            type: 'button',
            class: 'button toggle chip',
            'aria-pressed': String(draft.avoidance.has(item.id)),
            'data-item': item.id,
            onclick: () => {
              if (draft.avoidance.has(item.id)) draft.avoidance.delete(item.id);
              else draft.avoidance.add(item.id);
              button.setAttribute('aria-pressed', String(draft.avoidance.has(item.id)));
            },
          },
          item.label,
        );
        return button;
      }),
    );
    const known = new Set(avoidance.items.map((i) => i.id));
    const removed = [...draft.avoidance].filter((id) => !known.has(id)).length;

    const addButton = h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        'aria-label': t.avoidanceAddLabel,
        'aria-expanded': String(adding),
        'data-role': 'avoidance-add',
        onclick: () => {
          adding = !adding;
          addError = undefined;
          render();
          section.querySelector<HTMLElement>(adding ? 'input[name="avoidance-label"]' : '[data-role="avoidance-add"]')?.focus();
        },
      },
      t.avoidanceAdd,
    );
    if (avoidance.items.length > 0) chips.append(addButton);

    return h(
      'div',
      { class: 'evening-item' },
      h('p', { class: 'evening-item__title', id: titleId }, t.avoidanceQuestion, h('span', { class: 'muted' }, ` (${de.common.optional})`)),
      avoidance.items.length > 0 ? chips : h('p', { class: 'muted' }, t.avoidanceEmpty),
      avoidance.items.length === 0 ? h('div', { class: 'actions' }, addButton) : null,
      removed > 0 ? h('p', { class: 'hint' }, `+ ${removed} ${t.avoidanceRemoved}`) : null,
      adding ? addForm() : null,
      h('p', { class: 'hint' }, t.avoidanceHint, ' ', h('a', { href: routeHref('ausweichliste') }, t.avoidanceEdit)),
    );
  }

  function addForm(): HTMLElement {
    const id = uid('avoid-new');
    const errorId = `${id}-error`;
    const input = h('input', {
      id,
      type: 'text',
      name: 'avoidance-label',
      autocomplete: 'off',
      maxlength: appConfig.textLimits.short,
      'aria-describedby': errorId,
      'aria-invalid': addError ? 'true' : undefined,
      oninput: (e) => (addText = (e.target as HTMLInputElement).value),
    });
    input.value = addText;
    return h(
      'form',
      {
        class: 'inline-form',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          void run(async () => {
            const result = await addAvoidanceItem(ctx, addText);
            if (!result.ok) {
              addError =
                result.error === 'DUPLICATE'
                  ? de.avoidance.duplicate
                  : result.error === 'TOO_LONG'
                    ? de.errors.tooLong(appConfig.textLimits.short)
                    : de.errors.required;
              return undefined;
            }
            draft.avoidance.add(result.id);
            adding = false;
            addText = '';
            addError = undefined;
            await reload(view.day, true);
            return de.avoidance.added;
          }, () => (addError ? 'input[name="avoidance-label"]' : '[data-role="evening-status"]'));
        },
      },
      h('label', { for: id }, de.avoidance.addLabel),
      h('div', { class: 'inline-form__row' }, input, h('button', { type: 'submit', class: 'button', disabled: busy }, de.avoidance.add)),
      h('p', { id: errorId, class: 'form-error', hidden: !addError }, addError ?? ''),
    );
  }

  function exceptionBlock(): HTMLElement {
    const current = view.record?.exception;
    if (current) {
      return h(
        'div',
        { class: 'card notice exception', 'data-role': 'exception' },
        h('p', null, h('strong', null, t.exceptionSet(t.exceptionReasons[current.reason] ?? current.reason))),
        current.note ? h('p', { class: 'muted' }, current.note) : null,
        h('p', { class: 'hint' }, t.exceptionHint),
        h(
          'button',
          {
            type: 'button',
            class: 'button link',
            disabled: busy,
            'data-role': 'exception-clear',
            onclick: () =>
              void run(async () => {
                const result = await clearException(ctx, view.day);
                if (!result.ok) return de.errors.saveFailed;
                await reload(view.day, true);
                return t.exceptionCleared;
              }, () => '[data-role="exception-toggle"]'),
          },
          t.exceptionClear,
        ),
      );
    }
    if (!exceptionOpen) {
      return h(
        'div',
        { class: 'actions end' },
        h(
          'button',
          {
            type: 'button',
            class: 'button link',
            'aria-expanded': 'false',
            'data-role': 'exception-toggle',
            onclick: () => {
              exceptionOpen = true;
              render();
              section.querySelector<HTMLElement>('input[name="exception-reason"]:checked')?.focus();
            },
          },
          t.exceptionMark,
        ),
      );
    }
    const noteId = uid('exception-note');
    const note = h('textarea', {
      id: noteId,
      name: 'exception-note',
      maxlength: appConfig.textLimits.note,
      oninput: (e) => (exception.note = (e.target as HTMLTextAreaElement).value),
    });
    note.value = exception.note;
    return h(
      'form',
      {
        class: 'card exception-form',
        'data-role': 'exception-form',
        onsubmit: (e) => {
          e.preventDefault();
          void run(async () => {
            const note = exception.note.trim();
            const result = await setException(ctx, { day: view.day, reason: exception.reason, ...(note ? { note } : {}) });
            if (!result.ok) return de.errors.saveFailed;
            exceptionOpen = false;
            exception = { reason: 'SICK', note: '' };
            await reload(view.day, true);
            return t.exceptionSaved;
          });
        },
      },
      h('h2', null, t.exceptionTitle),
      h('p', { class: 'hint' }, t.exceptionHint),
      h(
        'fieldset',
        null,
        h('legend', null, t.exceptionReason),
        h(
          'div',
          { class: 'choices' },
          EXCEPTION_REASONS.map((reason) =>
            h(
              'label',
              { class: 'choice' },
              h('input', {
                type: 'radio',
                name: 'exception-reason',
                value: reason,
                checked: exception.reason === reason,
                onchange: () => (exception.reason = reason),
              }),
              h('span', null, t.exceptionReasons[reason] ?? reason),
            ),
          ),
        ),
      ),
      h('div', { class: 'field' }, h('label', { for: noteId }, t.exceptionNote, h('span', { class: 'muted' }, ` (${de.common.optional})`)), note),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'submit', class: 'button', disabled: busy }, t.exceptionSave),
        h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            onclick: () => {
              exceptionOpen = false;
              render();
              section.querySelector<HTMLElement>('[data-role="exception-toggle"]')?.focus();
            },
          },
          de.common.cancel,
        ),
      ),
    );
  }

  function close(): void {
    void run(async () => {
      const ids = new Set([view.procrastination?.habit.id, ...view.customs.map((c) => c.habit.id), ...view.open.map((o) => o.id)]);
      const result = await closeDay(ctx, {
        day: view.day,
        mood: draft.mood,
        energy: draft.energy,
        answers: [...draft.answers].filter(([id]) => ids.has(id)).map(([habitId, outcome]) => ({ habitId, outcome })),
        avoidanceItemIds: [...draft.avoidance],
      });
      if (!result.ok) return de.errors.saveFailed;
      await reload(view.day, false);
      return t.closed;
    });
  }

  function render(): void {
    const past = view.day !== view.today;
    const counters: Node[] = [];
    if (view.procrastination) {
      const { habit, checkIn } = view.procrastination;
      counters.push(answerGroup(habit.id, t.procrastinationQuestion, t.procrastination, Boolean(checkIn)));
    }
    if (view.avoidance) counters.push(avoidanceBlock(view.avoidance));
    for (const { habit, checkIn } of view.customs) counters.push(answerGroup(habit.id, habit.actionText, t.custom, Boolean(checkIn)));

    const buildLabels = { ...t.build, ...(past ? { NOT_DONE: t.buildPastNotDone } : {}) };
    const openTitle = uid('open');
    const statusLine = h(
      'p',
      { class: status?.error ? 'form-error' : 'status-line', role: 'status', tabindex: '-1', 'data-role': 'evening-status' },
      status?.text ?? (busy ? de.common.busy : ''),
    );

    section.replaceChildren(
      h('h1', { tabindex: '-1' }, t.heading, h('span', { class: 'date-line' }, ` · ${formatDayShort(view.day)}`)),
      dayPicker(view, (day) => {
        status = undefined;
        exceptionOpen = false;
        adding = false;
        void reload(day, false).then(() => {
          render();
          section.querySelector('h1')?.focus();
        });
      }),
      view.record?.closedAt && !status ? h('p', { class: 'muted', 'data-role': 'closed-before' }, t.closedBefore) : h('span', { hidden: true }),
      ratings(),
      counters.length > 0 ? h('div', { class: 'card evening-block', 'data-role': 'counters' }, ...counters) : h('span', { hidden: true }),
      view.open.length > 0
        ? h(
            'section',
            { class: 'card evening-block', 'aria-labelledby': openTitle, 'data-role': 'open' },
            h('h2', { id: openTitle }, t.open),
            view.open.map((habit) => answerGroup(habit.id, habit.actionText, buildLabels, false)),
          )
        : h('span', { hidden: true }),
      counters.length === 0 && view.open.length === 0 ? h('p', { class: 'muted' }, t.nothingToAsk) : h('span', { hidden: true }),
      h(
        'div',
        { class: 'actions split close-row' },
        h('button', { type: 'button', class: 'button primary', disabled: busy, 'data-role': 'close-day', onclick: close }, t.close),
        h('a', { class: 'button quiet', href: routeHref('heute') }, t.toToday),
      ),
      statusLine,
      exceptionBlock(),
    );
  }

  render();
  return section;
};
