import { recordCheckIn, type RecordCheckInInput } from '../../app/check-in';
import type { AppContext } from '../../app/context';
import { removeCheckIn } from '../../app/planning';
import { loadTodayView, type TodayCard, type TodayView } from '../../app/today';
import { appConfig } from '../../domain/app-config';
import type { LocalDate } from '../../domain/local-date';
import type { BuildOutcome, CheckIn } from '../../domain/types';
import { de } from '../../i18n/de';
import { h, icon, icons, uid } from '../dom';
import { formatCue, formatDayShort, formatWeekdayShort } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

/** Texte für heute oder für einen nachgetragenen Tag. */
function textsFor(past: boolean) {
  const t = de.today;
  const buttons: { outcome: BuildOutcome; label: string; primary?: boolean }[] = [
    { outcome: 'DONE', label: t.done, primary: true },
    { outcome: 'ALTERNATIVE', label: t.alternative },
    { outcome: 'NOT_DONE', label: past ? t.past.notDone : t.notDone },
  ];
  const confirmation: Record<BuildOutcome, string> = {
    DONE: past ? t.past.confirmDone : t.confirmDone,
    ALTERNATIVE: t.confirmAlternative,
    NOT_DONE: past ? t.past.confirmNotDone : t.confirmNotDone,
  };
  return {
    label: past ? t.past.label : t.nextStep,
    notPlanned: past ? t.past.notPlanned : undefined,
    changeHint: past ? t.past.changeHint : t.changeHint,
    noteLabel: past ? t.past.noteLabel : t.noteLabel,
    buttons,
    confirmation,
  };
}

interface CardState {
  card: TodayCard;
  day: LocalDate;
  correcting: boolean;
  noteOpen: boolean;
  busy: boolean;
  message?: string;
  error?: string;
}

/**
 * Eine Karte je aktivem Habit. Nach einer Aktion wird nur die Karte neu gezeichnet.
 * Während eine Speicherung läuft, sind alle Knöpfe der Karte gesperrt (Doppeltipp).
 * An nicht geplanten Tagen gibt es nur „Trotzdem gemacht“; der Eintrag lässt sich zurücknehmen.
 */
function habitCard(ctx: AppContext, initial: TodayCard, day: LocalDate, past: boolean): HTMLElement {
  const state: CardState = { card: initial, day, correcting: false, noteOpen: false, busy: false };
  const texts = textsFor(past);
  const titleId = uid('habit');
  const article = h('article', {
    class: `card habit-card${initial.planned ? '' : ' unplanned'}`,
    'aria-labelledby': titleId,
    'data-habit': initial.habit.id,
  });
  let focusAfterRender: 'confirmation' | 'note' | 'first-action' | undefined;

  async function run(action: () => Promise<boolean>) {
    if (state.busy) return;
    state.busy = true;
    state.error = undefined;
    state.message = undefined;
    render();
    try {
      if (!(await action())) state.error = de.errors.saveFailed;
    } catch {
      state.error = de.errors.saveFailed;
    } finally {
      state.busy = false;
      render();
    }
  }

  function save(input: Omit<RecordCheckInInput, 'habitId' | 'localDate'>, after?: (c: CheckIn) => void) {
    return run(async () => {
      const result = await recordCheckIn(ctx, { habitId: state.card.habit.id, localDate: state.day, ...input });
      if (!result.ok) return false;
      state.card = { ...state.card, checkIn: result.checkIn };
      after?.(result.checkIn);
      return true;
    });
  }

  function undo() {
    return run(async () => {
      const result = await removeCheckIn(ctx, { habitId: state.card.habit.id, localDate: state.day });
      if (!result.ok) return false;
      const { checkIn: _removed, ...rest } = state.card;
      state.card = rest;
      state.noteOpen = false;
      state.message = de.today.undone;
      focusAfterRender = 'first-action';
      return true;
    });
  }

  function outcomeButtons(current?: BuildOutcome): HTMLElement {
    return h(
      'div',
      { class: 'actions', role: 'group', 'aria-label': state.card.habit.actionText },
      texts.buttons.map((b) =>
        h(
          'button',
          {
            type: 'button',
            class: `button${b.primary ? ' primary' : ''}`,
            disabled: state.busy,
            'aria-pressed': current ? String(current === b.outcome) : undefined,
            onclick: () =>
              save({ outcome: b.outcome }, () => {
                state.correcting = false;
                focusAfterRender = 'confirmation';
              }),
          },
          b.label,
        ),
      ),
    );
  }

  function anywayButton(): HTMLElement {
    return h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          disabled: state.busy,
          onclick: () => save({ outcome: 'DONE' }, () => (focusAfterRender = 'confirmation')),
        },
        de.today.doneAnyway,
      ),
    );
  }

  function recorded(checkIn: CheckIn): (HTMLElement | null)[] {
    const outcome = checkIn.outcome as BuildOutcome;
    const planned = state.card.planned;
    const confirmation = h(
      'p',
      { class: 'confirmation', tabindex: '-1', 'data-role': 'confirmation' },
      h('span', null, planned ? texts.confirmation[outcome] : de.today.confirmAnyway),
    );
    if (outcome !== 'NOT_DONE') {
      const mark = icon(icons.check, 20);
      confirmation.prepend(mark);
      confirmation.append(h('span', { class: 'visually-hidden' }, ` ${de.today.doneMark}`));
    }

    const followups = h('div', { class: 'followups' });
    if (outcome === 'DONE' && planned) {
      followups.append(
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'checkbox',
            checked: checkIn.minimal,
            disabled: state.busy,
            onchange: (e) => save({ minimal: (e.target as HTMLInputElement).checked }),
          }),
          h('span', null, de.today.wasMinimal),
        ),
      );
    }
    followups.append(
      h(
        'button',
        {
          type: 'button',
          class: 'button link',
          'aria-expanded': String(state.noteOpen),
          disabled: state.busy,
          onclick: () => {
            state.noteOpen = !state.noteOpen;
            state.message = undefined;
            focusAfterRender = state.noteOpen ? 'note' : undefined;
            render();
          },
        },
        de.today.note,
      ),
      planned
        ? h(
            'button',
            {
              type: 'button',
              class: 'button link',
              'aria-expanded': String(state.correcting),
              disabled: state.busy,
              onclick: () => {
                state.correcting = !state.correcting;
                focusAfterRender = state.correcting ? 'first-action' : undefined;
                render();
              },
            },
            de.today.change,
          )
        : h('button', { type: 'button', class: 'button link', disabled: state.busy, onclick: () => void undo() }, de.today.undo),
    );
    return [
      confirmation,
      checkIn.note && !state.noteOpen ? h('p', { class: 'muted note-text', 'data-role': 'note-text' }, checkIn.note) : null,
      followups,
      state.correcting ? h('p', { class: 'hint' }, texts.changeHint) : null,
      state.correcting ? outcomeButtons(outcome) : null,
      state.noteOpen ? noteForm(checkIn) : null,
    ];
  }

  function noteForm(checkIn: CheckIn): HTMLElement {
    const id = uid('note');
    const textarea = h('textarea', {
      id,
      name: 'note',
      maxlength: appConfig.textLimits.note,
      'data-role': 'note',
    });
    textarea.value = checkIn.note ?? '';
    return h(
      'form',
      {
        class: 'note-form',
        onsubmit: (e) => {
          e.preventDefault();
          const value = textarea.value.trim();
          void save({ note: value ? value : null }, () => {
            state.noteOpen = false;
            state.message = de.today.noteSaved;
          });
        },
      },
      h('label', { for: id }, texts.noteLabel),
      textarea,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'submit', class: 'button', disabled: state.busy }, de.today.noteSave),
      ),
    );
  }

  function render() {
    const { habit, checkIn, planned, nextDate } = state.card;
    const label = planned
      ? texts.label
      : (texts.notPlanned ?? (nextDate ? de.today.notPlanned(formatWeekdayShort(nextDate)) : de.today.notPlannedNoNext));
    const children: (Node | null)[] = [
      h('p', { class: 'label', 'data-role': 'card-label' }, label),
      h('h2', { id: titleId }, habit.actionText),
      planned && habit.cue ? h('p', { class: 'detail' }, formatCue(habit.cue)) : null,
      planned && habit.minimumText ? h('p', { class: 'detail muted' }, de.today.minimum(habit.minimumText)) : null,
    ];
    if (checkIn) children.push(...recorded(checkIn));
    else children.push(planned ? outcomeButtons() : anywayButton());
    children.push(
      h(
        'p',
        { class: state.error ? 'form-error' : 'status-line', role: 'status', 'aria-live': 'polite' },
        state.error ?? state.message ?? (state.busy ? de.common.busy : ''),
      ),
    );
    article.replaceChildren(...children.filter((c): c is Node => c !== null));

    const target = focusAfterRender;
    focusAfterRender = undefined;
    if (target === 'confirmation') article.querySelector<HTMLElement>('[data-role="confirmation"]')?.focus();
    else if (target === 'note') article.querySelector<HTMLElement>('[data-role="note"]')?.focus();
    else if (target === 'first-action') article.querySelector<HTMLElement>('.actions button')?.focus();
  }

  render();
  return article;
}

/** Auswahl des Tages: heute oder bis zu sieben Tage zurück. */
function dayPicker(view: TodayView, onPick: (day: LocalDate) => void): HTMLElement {
  return h(
    'details',
    { class: 'day-picker', open: view.day !== view.today },
    h('summary', { class: 'button link' }, de.today.pickDay),
    h('p', { class: 'hint' }, de.today.backfillHint(appConfig.checkInBackfillDays)),
    h(
      'ul',
      { 'aria-label': de.today.pickDayLabel },
      view.days.map((d) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'button quiet',
              'aria-pressed': String(d === view.day),
              'data-day': d,
              onclick: () => onPick(d),
            },
            d === view.today ? de.today.todayOption : formatDayShort(d),
          ),
        ),
      ),
    ),
  );
}

export const todayScreen: Screen = async ({ ctx }) => {
  const section = h('section', { class: 'screen' });

  async function show(day: LocalDate | undefined, focus: boolean): Promise<void> {
    const view = await loadTodayView(ctx, day);
    const past = view.day !== view.today;
    const heading = h(
      'h1',
      { tabindex: '-1' },
      past ? de.today.backfillHeading : de.today.heading,
      h('span', { class: 'date-line' }, ` · ${formatDayShort(view.day)}`),
    );
    const nodes: Node[] = [heading];
    if (past) {
      nodes.push(
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { type: 'button', class: 'button link', onclick: () => void show(undefined, true) },
            de.today.backToToday,
          ),
        ),
      );
    }

    if (view.cards.length === 0) {
      nodes.push(
        past
          ? h('div', { class: 'card empty' }, h('p', null, de.today.past.emptyTitle))
          : h(
              'div',
              { class: 'card empty' },
              h('p', null, de.today.emptyTitle),
              h('p', { class: 'muted' }, de.today.emptyBody),
              h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
            ),
      );
    } else {
      for (const card of view.cards) nodes.push(habitCard(ctx, card, view.day, past));
    }
    nodes.push(dayPicker(view, (d) => void show(d, true)));
    section.replaceChildren(...nodes);
    if (focus) heading.focus();
  }

  await show(undefined, false);
  return section;
};
